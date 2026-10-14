import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { DeviceRound } from "@/domain/offline/types";

// Read only the public routing metadata, under the signed-in driver's RLS.
// Device tokens remain encrypted locally and are never part of this lookup.
export async function readOfflineRound(trip: string) {
  const { data, error } = await (
    await createClient()
  )
    .from("driver_offline_rounds")
    .select("trip_id,phase")
    .eq("trip_id", trip)
    .maybeSingle();
  if (error)
    throw new OfflineServerError(
      error.code === "42501"
        ? "AUTHORIZATION"
        : [
              "PGRST202",
              "PGRST204",
              "PGRST205",
              "42883",
              "42P01",
              "42703",
              "25006",
            ].includes(error.code)
          ? "MIGRATION_REQUIRED"
          : ["PGRST301", "PGRST302", "PGRST303", "28000", "28P01"].includes(
                error.code,
              )
            ? "AUTHENTICATION"
            : "TEMPORARY",
      "Delivery round access could not be checked. Please retry.",
      error.code === "42501"
        ? 403
        : ["PGRST301", "PGRST302", "PGRST303", "28000", "28P01"].includes(
              error.code,
            )
          ? 401
          : 503,
    );
  return data as Pick<DeviceRound, "trip_id" | "phase"> | null;
}
export class OfflineServerError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function offlineRpc<T>(
  name: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const { data, error } = await (await createClient()).rpc(name, args);
  if (error) {
    if (
      [
        "PGRST202",
        "PGRST204",
        "PGRST205",
        "42883",
        "42P01",
        "42703",
        "25006",
      ].includes(error.code)
    )
      throw new OfflineServerError(
        "MIGRATION_REQUIRED",
        "Offline synchronization requires a database update. Contact the admin; device records are preserved.",
        503,
      );
    if (
      ["PGRST301", "PGRST302", "PGRST303", "28000", "28P01"].includes(
        error.code,
      )
    )
      throw new OfflineServerError(
        "AUTHENTICATION",
        "Sign in online again. Device records are preserved.",
        401,
      );
    if (error.code === "42501")
      throw new OfflineServerError(
        "AUTHORIZATION",
        "Driver authorization or device access is unavailable. Saved records need review.",
        403,
      );
    if (["22023", "23505", "23503"].includes(error.code))
      throw new OfflineServerError(
        "BUSINESS_CONFLICT",
        "The saved record needs review. Keep it on this device and contact the warehouse admin.",
        409,
      );
    throw new OfflineServerError(
      "TEMPORARY",
      "The server could not be reached. Saved records will retry.",
      503,
    );
  }
  return data as T;
}
