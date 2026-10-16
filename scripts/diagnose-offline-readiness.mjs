import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

// Read-only diagnosis of the already linked project. Never prints tokens,
// encryption material, operation payloads, passwords or customer information.
const ref = readFileSync("supabase/.temp/project-ref", "utf8").trim();
if (
  process.env.NEXT_PUBLIC_SUPABASE_URL !== `https://${ref}.supabase.co` ||
  !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  !process.env.DEMO_ADMIN_PASSWORD
)
  throw new Error("The existing linked-project configuration is required.");
const client = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (url, init) =>
        fetch(url, { ...init, signal: AbortSignal.timeout(15000) }),
    },
  },
);
const auth = await client.auth.signInWithPassword({
  email: process.env.DEMO_ADMIN_EMAIL ?? "admin@mount-kailash.example",
  password: process.env.DEMO_ADMIN_PASSWORD,
});
if (auth.error || !auth.data.user)
  throw new Error("Existing diagnostic admin sign-in failed.");
const profile = await client
  .from("profiles")
  .select("role,is_active")
  .eq("id", auth.data.user.id)
  .single();
if (profile.error || profile.data.role !== "ADMIN" || !profile.data.is_active)
  throw new Error("Existing active admin access is required.");
const [workspace, rounds, devices, reset, preparation] = await Promise.all([
  client.rpc("operations_workspace", { p_trip: null }),
  client.rpc("offline_admin_workspace"),
  client.rpc("trusted_device_directory"),
  client
    .from("driver_offline_rounds")
    .select(
      "offline_device_reset_pending,offline_device_reset_at,offline_device_reset_by",
    )
    .limit(0),
  client.rpc("offline_preparation_access", {
    p_trip: null,
    p_device: null,
    p_token: null,
  }),
]);
if (workspace.error)
  throw new Error(
    `Read-only workspace diagnosis failed (${workspace.error.code}).`,
  );
// PostgreSQL resolves column names before checking table privileges. A 42501
// means these columns exist but the app intentionally exposes them via RPCs.
const resetColumnsPresent =
  !reset.error || reset.error.code === "42501"
    ? true
    : ["42703", "42P01", "PGRST204", "PGRST205"].includes(reset.error.code)
      ? false
      : null;
const preparationRpcPresent =
  !preparation.error || ["42501", "MK001"].includes(preparation.error.code)
    ? true
    : ["42883", "PGRST202"].includes(preparation.error.code)
      ? false
      : null;
console.log(
  JSON.stringify(
    {
      readOnly: true,
      resetColumnsPresent,
      preparationRpcPresent,
      resetSchemaError: reset.error?.code ?? null,
      roundsError: rounds.error?.code ?? null,
      devicesError: devices.error?.code ?? null,
      trips: workspace.data.trips
        .filter((trip) => ["LOADED", "ACTIVE"].includes(trip.status))
        .map((trip) => {
          const round = rounds.data?.rounds.find(
            (row) => row.trip_id === trip.id,
          );
          const trusted =
            devices.data?.filter(
              (row) => row.driver_id === trip.driver_id && !row.revoked_at,
            ) ?? [];
          return {
            tripNumber: trip.trip_number,
            status: trip.status,
            hasBoundOfflineRound: !!round,
            phase: round?.phase ?? null,
            confirmedSequence: round?.confirmed_sequence ?? null,
            reportedPending: round?.reported_pending ?? null,
            activeRegisteredDevices: trusted.length,
            boundDeviceRegistered:
              !!round &&
              trusted.some((row) => row.device_id === round.device_id),
          };
        }),
    },
    null,
    2,
  ),
);
