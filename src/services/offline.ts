import "server-only";
import { can } from "@/domain/auth/roles";
import { readCurrentProfile } from "@/data-access/profiles";
import {
  offlineRpc,
  OfflineServerError,
  readOfflineRound,
} from "@/data-access/offline";
import { readOperations } from "@/data-access/operations";
import { readFinance } from "@/data-access/finance";
import { getLocale } from "@/lib/i18n/server";
import { currentRound } from "@/domain/operations/driver-workspace";
import { validateEnvelope } from "@/domain/offline/operations";
import { createHash } from "node:crypto";
import { uuid } from "@/domain/inventory/validation";
import type {
  DeviceRound,
  OfflineSnapshot,
  Receipt,
} from "@/domain/offline/types";
import type { DeliveryCustomerContext } from "@/domain/operations/customer-context";
import { confirmedCustomerContext } from "@/domain/operations/confirmed-customer";
import { ProfileAccessError } from "@/domain/auth/access-errors";
import { diagnoseOfflineOwnership } from "./offline-diagnostics";
import { readInstantWorkspace } from "@/data-access/instant";

export async function offlineIdentity() {
  const profile = await readCurrentProfile().catch((error) => {
    if (error instanceof ProfileAccessError)
      throw new OfflineServerError(
        error.code,
        error.code === "NETWORK"
          ? "Network unavailable. Saved records will retry when connected."
          : error.code === "SCHEMA"
            ? "Offline synchronization requires a database update. Contact the admin; device records are preserved."
            : "The server could not be reached. Saved records will retry.",
        503,
      );
    throw error;
  });
  if (!profile)
    throw new OfflineServerError(
      "AUTHENTICATION",
      "Sign in online again. Device records are preserved.",
      401,
    );
  if (profile.role !== "DRIVER" || !can(profile, "driver:read"))
    throw new OfflineServerError(
      "AUTHORIZATION",
      "Driver authorization is unavailable. Saved records need review.",
      403,
    );
  return profile;
}
export async function offlineCurrent() {
  const profile = await offlineIdentity(),
    workspace = await readOperations();
  const trip = currentRound(workspace)?.id ?? null;
  return {
    profile,
    trip,
    round: trip ? await readOfflineRound(trip) : null,
    locale: await getLocale(profile),
  };
}
function credentials(body: Record<string, unknown>) {
  const trip = uuid(String(body.trip)),
    device = uuid(String(body.device)),
    token = body.token;
  if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token))
    throw new OfflineServerError("INVALID", "Invalid offline record.", 400);
  return { p_trip: trip, p_device: device, p_token: token };
}
export async function offlineSnapshot(
  args: ReturnType<typeof credentials>,
): Promise<OfflineSnapshot> {
  const profile = await offlineIdentity();
  const before = await offlineRpc<{ round: DeviceRound; receipts: Receipt[] }>(
    "offline_read_state",
    args,
  );
  const workspace = await readOperations(args.p_trip);
  const finance = await readFinance();
  const instant = await readInstantWorkspace();
  const contexts =
    before.round.phase === "ACTIVE" || before.round.phase === "PREPARED"
      ? await offlineRpc<DeliveryCustomerContext[]>("offline_contexts", {
          p_trip: args.p_trip,
        })
      : [];
  const retainedOperations = await offlineRpc<
    import("@/domain/offline/types").Envelope[]
  >("offline_device_journal", args);
  const after = await offlineRpc<typeof before>("offline_read_state", args);
  // A same-device concurrent upload invalidates the combined snapshot; retry it,
  // rather than acknowledging records against balances from an earlier read.
  if (
    before.round.confirmed_sequence !== after.round.confirmed_sequence ||
    before.round.phase !== after.round.phase
  )
    throw new OfflineServerError(
      "TEMPORARY",
      "Stock changed while downloading. Retry synchronization.",
      503,
    );
  const hours = Number(process.env.OFFLINE_AUTH_MAX_HOURS ?? 24);
  const authorizationHours =
    Number.isFinite(hours) && hours >= 1 && hours <= 72 ? hours : 24;
  return {
    profile,
    workspace,
    finance,
    instant,
    contexts: contexts.map((c) => confirmedCustomerContext(c)),
    receipts: after.receipts,
    retainedOperations,
    round: after.round,
    locale: await getLocale(profile),
    fetchedAt: new Date().toISOString(),
    authorizedUntil: new Date(
      Date.now() + authorizationHours * 3600000,
    ).toISOString(),
  };
}
export async function offlineCommand(body: Record<string, unknown>) {
  const profile = await offlineIdentity();
  const args = credentials(body);
  switch (body.action) {
    case "register": {
      const access = await offlineRpc<{ replace_installation?: boolean }>(
        "offline_preparation_access",
        args,
      );
      if (access?.replace_installation)
        throw new OfflineServerError(
          "DEVICE_RESET_REQUIRED",
          "Prepare fresh device credentials after the admin reset.",
          403,
        );
      await offlineRpc("offline_register", args);
      await diagnoseOfflineOwnership(
        profile.id,
        args.p_device,
        "ROUND_REGISTERED",
      );
      return offlineSnapshot(args);
    }
    case "snapshot":
      return offlineSnapshot(args);
    case "status":
      return offlineRpc("offline_read_state", args);
    case "checkin":
      return offlineRpc("offline_checkin", {
        ...args,
        p_pending: body.pending,
      });
    case "post": {
      const e = validateEnvelope(body.operation);
      if (
        e.trip !== args.p_trip ||
        createHash("sha256").update(e.payload).digest("hex") !== e.fingerprint
      )
        throw new OfflineServerError("INVALID", "Invalid offline record.", 400);
      return offlineRpc<Receipt>("offline_post", {
        ...args,
        p_id: e.id,
        p_sequence: e.sequence,
        p_kind: e.kind,
        p_occurred: e.occurredAt,
        p_payload: e.payload,
        p_fingerprint: e.fingerprint,
      });
    }
    default:
      throw new OfflineServerError("INVALID", "Invalid offline action.", 400);
  }
}
