import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

// No valid business command is issued. The null request key rejects before any
// stock, trip, audit or operation-request write, even after migration 23 exists.
const ref = readFileSync("supabase/.temp/project-ref", "utf8").trim();
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (
  url !== `https://${ref}.supabase.co` ||
  !key ||
  !process.env.DEMO_ADMIN_PASSWORD
)
  throw new Error(
    "Existing linked-project diagnostic credentials are required.",
  );
const client = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: {
    fetch: (input, init) =>
      fetch(input, { ...init, signal: AbortSignal.timeout(15000) }),
  },
});
const auth = await client.auth.signInWithPassword({
  email: process.env.DEMO_ADMIN_EMAIL ?? "admin@mount-kailash.example",
  password: process.env.DEMO_ADMIN_PASSWORD,
});
if (auth.error || !auth.data.user)
  throw new Error("Existing admin authentication failed.");
const profile = await client
  .from("profiles")
  .select("role,is_active,approval_status")
  .eq("id", auth.data.user.id)
  .single();
if (profile.error || profile.data.role !== "ADMIN" || !profile.data.is_active)
  throw new Error("Active admin authorization is required.");
const snapshot = async () => {
  const results = await Promise.all([
    client.rpc("operations_workspace", { p_trip: null }),
    client.rpc("finance_workspace"),
  ]);
  if (results.some((r) => r.error))
    throw new Error("Existing business snapshots could not be read.");
  return createHash("sha256")
    .update(JSON.stringify(results.map((r) => r.data)))
    .digest("hex");
};
const before = await snapshot();
const result = await client.rpc("schedule_trip", {
  p_id: null,
  p_driver: null,
  p_vehicle: null,
  p_day: null,
  p_scheduled: null,
  p_notes: null,
  p_key: null,
});
console.log(
  JSON.stringify({
    request: "POST /rest/v1/rpc/schedule_trip",
    status: result.status,
    code: result.error?.code ?? null,
    message: result.error?.message ?? null,
    safeNullKeyProbe: true,
  }),
);
if (!result.error || !["PGRST202", "22023"].includes(result.error.code))
  throw new Error(
    "Unexpected diagnostic response; no valid trip was submitted.",
  );
const columns = await client
  .from("trips")
  .select("scheduled_date,loading_business_day_id")
  .limit(0);
console.log(
  JSON.stringify({
    request:
      "GET /rest/v1/trips?select=scheduled_date,loading_business_day_id&limit=0",
    status: columns.status,
    code: columns.error?.code ?? null,
  }),
);
const devices = await client.rpc("trusted_device_directory");
console.log(
  JSON.stringify({
    request: "POST /rest/v1/rpc/trusted_device_directory",
    status: devices.status,
    code: devices.error?.code ?? null,
  }),
);
const businessSnapshotUnchanged = before === (await snapshot());
console.log(JSON.stringify({ businessSnapshotUnchanged }));
if (!businessSnapshotUnchanged)
  throw new Error("Business snapshots changed during the diagnostic.");
if (
  process.argv.includes("--expect-installed") &&
  (result.error?.code !== "22023" || columns.error || devices.error)
)
  throw new Error("The installed trip/device schema checks failed.");
