import "server-only";
import { offlineRpc } from "@/data-access/offline";

// Deliberately whitelist scalar metadata. Never log request bodies, errors,
// tokens, hashes, recovery material or operation records.
export async function diagnoseOfflineOwnership(
  driver: string,
  incomingDevice: string | null,
  result:
    | "STATUS"
    | "REGISTERED"
    | "REPLACEMENT_REQUIRED"
    | "DENIED"
    | "ROUND_REGISTERED",
) {
  if (process.env.NODE_ENV !== "development") return;
  try {
    const data = await offlineRpc<Record<string, unknown>>(
      "offline_ownership_diagnostics",
      { p_driver: driver, p_device: incomingDevice },
    );
    const metadata: Record<string, string | boolean | null> = { result };
    for (const key of [
      "driver_id",
      "current_trip_id",
      "round_device_id",
      "incoming_device_id",
    ])
      metadata[key] =
        typeof data[key] === "string" && /^[a-f0-9-]{36}$/.test(data[key])
          ? data[key]
          : null;
    metadata.round_phase = [
      "PREPARED",
      "ACTIVE",
      "PAUSED",
      "SEALED",
      "EXCEPTION",
    ].includes(String(data.round_phase))
      ? String(data.round_phase)
      : null;
    for (const key of [
      "trusted_device_exists",
      "trusted_device_revoked",
      "replacement_allowed",
      "reset_eligible",
      "incoming_trusted_exists",
      "incoming_trusted_revoked",
    ])
      metadata[key] = data[key] === true;
    if (result === "ROUND_REGISTERED")
      metadata.transfer_result =
        metadata.round_device_id === incomingDevice
          ? "BOUND_TO_INCOMING_DEVICE"
          : "NOT_BOUND_TO_INCOMING_DEVICE";
    console.info("[offline ownership]", metadata);
  } catch {
    // Diagnostics must not alter behavior, including before migration deployment.
  }
}
