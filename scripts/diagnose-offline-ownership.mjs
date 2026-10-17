import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

// Read-only Cloud diagnosis. Project/auth configuration is never printed.
const ref = readFileSync("supabase/.temp/project-ref", "utf8").trim();
if (
  process.env.NEXT_PUBLIC_SUPABASE_URL !== `https://${ref}.supabase.co` ||
  !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  !process.env.DEMO_ADMIN_PASSWORD
)
  throw new Error(
    "Existing linked-project diagnostic configuration is required.",
  );
const client = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (url, init) =>
        fetch(url, { ...init, signal: AbortSignal.timeout(20000) }),
    },
  },
);
const auth = await client.auth.signInWithPassword({
  email: process.env.DEMO_ADMIN_EMAIL ?? "admin@mount-kailash.example",
  password: process.env.DEMO_ADMIN_PASSWORD,
});
if (auth.error || !auth.data.user)
  throw new Error("Existing diagnostic admin authentication failed.");
try {
  const results = await Promise.all([
    client.rpc("operations_workspace", { p_trip: null }),
    client.rpc("offline_admin_workspace"),
    client.rpc("trusted_device_directory"),
  ]);
  if (results.some((r) => r.error))
    throw new Error("Authorized ownership readers are unavailable.");
  const [workspace, offline, devices] = results.map((r) => r.data);
  const drivers = workspace.drivers.filter((d) => /rabindra/i.test(d.name));
  if (drivers.length !== 1)
    throw new Error("A unique target driver could not be identified.");
  const driver = drivers[0];
  const trips = workspace.trips.filter((t) => t.driver_id === driver.id);
  const priority = [
    "ACTIVE",
    "LOADED",
    "DRAFT",
    "SUBMITTED",
    "UNDER_REVIEW",
    "DISCREPANCY",
  ];
  const current = trips
    .filter((t) => !t.cancelled && priority.includes(t.status))
    .sort(
      (a, b) =>
        priority.indexOf(a.status) - priority.indexOf(b.status) ||
        (a.scheduled_date ?? a.date_label ?? "").localeCompare(
          b.scheduled_date ?? b.date_label ?? "",
        ) ||
        b.created_at.localeCompare(a.created_at) ||
        b.trip_number - a.trip_number ||
        a.id.localeCompare(b.id),
    )[0];
  const admin = await client.rpc("admin_driver_offline_access", {
    p_driver: driver.id,
  });
  if (admin.error)
    throw new Error(`Admin status unavailable (${admin.error.code}).`);
  const round = offline.rounds.find((r) => r.trip_id === current?.id);
  const trusted = devices.filter((d) => d.driver_id === driver.id);
  let driverRoundRead = null;
  if (process.env.DEMO_DRIVER_PASSWORD) {
    const own = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      {
        auth: { persistSession: false, autoRefreshToken: false },
        global: {
          fetch: (url, init) =>
            fetch(url, { ...init, signal: AbortSignal.timeout(20000) }),
        },
      },
    );
    try {
      const login = await own.auth.signInWithPassword({
        email: process.env.DEMO_DRIVER_EMAIL ?? "driver@mount-kailash.example",
        password: process.env.DEMO_DRIVER_PASSWORD,
      });
      if (login.error || login.data.user?.id !== driver.id) {
        driverRoundRead = {
          verified: false,
          reason: login.error
            ? "Diagnostic driver login unavailable"
            : "Demo driver differs from target driver",
        };
      } else {
        const read = await own
          .from("driver_offline_rounds")
          .select("trip_id,phase,device_id")
          .eq("trip_id", current.id)
          .maybeSingle();
        driverRoundRead = {
          verified: true,
          status: read.status,
          errorCode: read.error?.code ?? null,
          row: read.data,
        };
      }
    } finally {
      await own.auth.signOut();
    }
  }
  // Explicit whitelist: never print raw RPC responses, operation payloads or hashes.
  console.log(
    JSON.stringify(
      {
        readOnly: true,
        driverId: driver.id,
        adminBefore: {
          tripId: admin.data.trip_id,
          tripNumber: admin.data.trip_number,
          status: admin.data.status,
          deviceRegistered: admin.data.device_registered,
          resetPending: admin.data.reset_pending,
          canReset: admin.data.can_reset,
        },
        driverSelection: {
          tripId: current?.id ?? null,
          tripNumber: current?.trip_number ?? null,
          status: current?.status ?? null,
        },
        driverRound: round
          ? {
              tripId: round.trip_id,
              phase: round.phase,
              deviceId: round.device_id,
              resetPending: round.offline_device_reset_pending,
              resetAt: round.offline_device_reset_at,
            }
          : null,
        driverRoundRead,
        trustedDevices: trusted.map((d) => ({
          deviceId: d.device_id,
          revoked: !!d.revoked_at,
        })),
        assignedOpenTrips: trips
          .filter(
            (t) => !t.cancelled && ["LOADED", "ACTIVE"].includes(t.status),
          )
          .map((t) => ({
            id: t.id,
            number: t.trip_number,
            status: t.status,
            scheduled: t.scheduled_date,
          })),
      },
      null,
      2,
    ),
  );
} finally {
  await client.auth.signOut();
}
