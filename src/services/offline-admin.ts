import "server-only";
import { requirePermission } from "./auth";
import { offlineRpc, OfflineServerError } from "@/data-access/offline";
import { uuid } from "@/domain/inventory/validation";
import type { DeviceRound } from "@/domain/offline/types";
export type OfflineAdminWorkspace = {
  available: boolean;
  rounds: (DeviceRound & { driver_name: string; trip_number: number })[];
  operations: {
    id: string;
    trip_id: string;
    kind: string;
    sequence: number;
    status: string;
    payload: string;
    occurred_at: string;
    processed_at: string;
    message: string | null;
  }[];
  reviews: {
    id: string;
    operation_id: string | null;
    trip_id: string;
    action: string;
    reason: string;
    created_at: string;
  }[];
};
export async function getOfflineAdmin(): Promise<OfflineAdminWorkspace> {
  await requirePermission("admin:read");
  try {
    return {
      ...(await offlineRpc<Omit<OfflineAdminWorkspace, "available">>(
        "offline_admin_workspace",
      )),
      available: true,
    };
  } catch (e) {
    if (e instanceof OfflineServerError && e.code === "MIGRATION_REQUIRED")
      return { available: false, rounds: [], operations: [], reviews: [] };
    throw e;
  }
}
export async function saveOfflineAdmin(form: FormData) {
  await requirePermission("admin:read");
  const key = uuid(String(form.get("key"))),
    reason = String(form.get("reason") ?? "").trim();
  if (reason.length < 3 || reason.length > 500)
    throw new Error("Enter a reason between 3 and 500 characters.");
  if (form.get("operation") === "offline:revoke-device")
    return offlineRpc<string>("trusted_device_revoke", {
      p_device: uuid(String(form.get("id"))),
      p_reason: reason,
    });
  if (form.get("operation") === "offline:review") {
    const action = String(form.get("action"));
    if (
      ![
        "RETRY",
        "MATCH_CUSTOMER",
        "REBASE_CUSTODY",
        "AUTHORIZE_HOUSE",
        "REJECT",
      ].includes(action)
    )
      throw new Error("Select a review action and enter a reason.");
    return offlineRpc<string>("offline_admin_review", {
      p_id: uuid(String(form.get("id"))),
      p_action: action,
      p_customer:
        action === "MATCH_CUSTOMER" ? uuid(String(form.get("customer"))) : null,
      p_reason: reason,
      p_key: key,
    });
  }
  if (form.get("operation") === "offline:exception") {
    const counts = JSON.parse(String(form.get("counts"))) as {
      product_id: string;
      stock_kind: string;
      quantity: number;
    }[];
    if (
      !Array.isArray(counts) ||
      !counts.length ||
      counts.length > 150 ||
      counts.some(
        (c) =>
          !Number.isSafeInteger(c.quantity) ||
          c.quantity < 0 ||
          !["FULL_JAR", "EMPTY_JAR", "BOTTLE_CARTON"].includes(c.stock_kind),
      )
    )
      throw new Error("Enter valid physical return counts.");
    for (const c of counts) uuid(c.product_id);
    return offlineRpc<string>("offline_admin_exception", {
      p_trip: uuid(String(form.get("trip"))),
      p_counts: counts,
      p_reason: reason,
      p_key: key,
    });
  }
  throw new Error("Select a review action and enter a reason.");
}
export async function getTrustedDevices() {
  await requirePermission("admin:read");
  try {
    return await offlineRpc<
      {
        device_id: string;
        driver_name: string;
        name: string;
        last_seen_at: string;
        last_synced_at: string | null;
        revoked_at: string | null;
      }[]
    >("trusted_device_directory");
  } catch (e) {
    if (e instanceof OfflineServerError && e.code === "MIGRATION_REQUIRED")
      return null;
    throw e;
  }
}
