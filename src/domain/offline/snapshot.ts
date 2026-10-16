import type { LocalState, OfflineSnapshot } from "./types";
import { confirmAcknowledgement } from "./operations";
import { confirmedCustomerContext } from "@/domain/operations/confirmed-customer";
import { can } from "@/domain/auth/roles";
import { uuid } from "@/domain/inventory/validation";
const mismatch =
  "Server confirmation did not match. The record remains on this device.";
export function installConfirmedSnapshot(
  state: LocalState,
  snapshot: OfflineSnapshot,
) {
  if (
    !snapshot ||
    snapshot.profile?.id !== state.user ||
    !can(snapshot.profile, "driver:read") ||
    snapshot.round?.trip_id !== state.snapshot.round.trip_id ||
    snapshot.round.driver_id !== state.user ||
    snapshot.round.device_id !== state.device ||
    !Array.isArray(snapshot.receipts) ||
    !Array.isArray(snapshot.contexts) ||
    !Array.isArray(snapshot.workspace?.trips) ||
    !Array.isArray(snapshot.workspace.customers) ||
    !snapshot.workspace.trips.some(
      (t) => t.id === snapshot.round.trip_id && t.driver_id === state.user,
    ) ||
    !["PREPARED", "ACTIVE", "PAUSED", "SEALED", "EXCEPTION"].includes(
      snapshot.round.phase,
    ) ||
    !Number.isFinite(Date.parse(snapshot.fetchedAt)) ||
    !Number.isFinite(Date.parse(snapshot.authorizedUntil)) ||
    Date.parse(snapshot.fetchedAt) < Date.parse(state.snapshot.fetchedAt) ||
    (snapshot.round.phase === "PREPARED" &&
      state.snapshot.round.phase !== "PREPARED") ||
    !Number.isSafeInteger(snapshot.round.confirmed_sequence) ||
    snapshot.round.confirmed_sequence < state.snapshot.round.confirmed_sequence
  )
    throw new Error(mismatch);
  const receipts = snapshot.receipts.filter((r) => r.status === "CONFIRMED");
  const inherited = state.inheritedReceipts ?? [];
  for (const receipt of inherited) {
    uuid(receipt.id);
    if (!receipt.result || !Number.isFinite(Date.parse(receipt.processedAt)))
      throw new Error(mismatch);
    uuid(receipt.result);
  }
  if (
    new Set(receipts.map((r) => r.id)).size !== receipts.length ||
    new Set(receipts.map((r) => r.sequence)).size !== receipts.length ||
    receipts.length !== snapshot.round.confirmed_sequence ||
    inherited.some(
      (r, i) =>
        r.status !== "CONFIRMED" ||
        r.sequence !== i + 1 ||
        r.trip !== snapshot.round.trip_id ||
        !/^[a-f0-9]{64}$/.test(r.fingerprint),
    )
  )
    throw new Error(mismatch);
  for (const receipt of receipts) {
    const previous = inherited.find((r) => r.id === receipt.id);
    if (previous) {
      if (
        previous.sequence !== receipt.sequence ||
        previous.trip !== receipt.trip ||
        previous.fingerprint !== receipt.fingerprint ||
        previous.result !== receipt.result ||
        previous.processedAt !== receipt.processedAt ||
        (previous.customer ?? null) !== (receipt.customer ?? null)
      )
        throw new Error(mismatch);
      continue;
    }
    const op = state.operations.find((o) => o.id === receipt.id);
    if (!op || receipt.sequence > snapshot.round.confirmed_sequence)
      throw new Error(mismatch);
    confirmAcknowledgement(op, receipt);
  }
  if (inherited.some((r) => !receipts.some((next) => next.id === r.id)))
    throw new Error(mismatch);
  for (const op of state.operations) {
    const receipt = receipts.find((r) => r.id === op.id);
    if (
      (op.sequence <= snapshot.round.confirmed_sequence ||
        op.status === "SYNCED") &&
      !receipt
    )
      throw new Error(mismatch);
  }
  const contexts = snapshot.contexts.map((c) => confirmedCustomerContext(c));
  if (
    new Set(contexts.map((c) => c.customer.id)).size !== contexts.length ||
    contexts.some(
      (c) => !snapshot.workspace.customers.some((w) => w.id === c.customer.id),
    ) ||
    (snapshot.round.phase === "ACTIVE" &&
      snapshot.workspace.customers.some(
        (w) => w.is_active && !contexts.some((c) => c.customer.id === w.id),
      ))
  )
    throw new Error(mismatch);
  // Validate EVERYTHING before replacing any confirmed state. Queued payloads,
  // stable IDs, sequences and fingerprints are never rewritten by a download.
  for (const receipt of receipts) {
    const op = state.operations.find((o) => o.id === receipt.id);
    if (!op) continue; // Validated inherited history has no local draft to replay.
    op.status = "SYNCED";
    op.acknowledgement = receipt;
    op.message = undefined;
  }
  state.snapshot = { ...snapshot, contexts };
  state.sealed =
    state.sealed || ["SEALED", "EXCEPTION"].includes(snapshot.round.phase);
  state.paused =
    snapshot.round.phase === "PAUSED" ||
    state.operations.some((o) => o.kind === "PAUSE" && o.status !== "SYNCED");
  state.lastSynced = snapshot.fetchedAt;
}
