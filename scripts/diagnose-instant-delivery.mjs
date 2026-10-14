import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
const ref = readFileSync("supabase/.temp/project-ref", "utf8").trim();
if (
  process.env.NEXT_PUBLIC_SUPABASE_URL !== `https://${ref}.supabase.co` ||
  !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
)
  throw new Error("The existing linked-project configuration is required.");
for (const role of ["ADMIN", "DRIVER"]) {
  const password = process.env[`DEMO_${role}_PASSWORD`];
  if (!password)
    throw new Error("Existing diagnostic account credentials are required.");
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
    email:
      process.env[`DEMO_${role}_EMAIL`] ??
      `${role.toLowerCase()}@mount-kailash.example`,
    password,
  });
  if (auth.error || !auth.data.user)
    throw new Error("Existing diagnostic sign-in failed.");
  const profile = await client
    .from("profiles")
    .select("role,is_active,approval_status")
    .eq("id", auth.data.user.id)
    .single();
  if (
    profile.error ||
    profile.data.role !== role ||
    !profile.data.is_active ||
    (role === "DRIVER" && profile.data.approval_status !== "APPROVED")
  )
    throw new Error("The existing approved diagnostic account is required.");
  const snapshot = async () => {
    const [w, f] = await Promise.all([
      client.rpc("operations_workspace", { p_trip: null }),
      client.rpc("finance_workspace"),
    ]);
    if (w.error || f.error)
      throw new Error("Existing authorized workspace reads failed.");
    return {
      data: w.data,
      hash: createHash("sha256")
        .update(JSON.stringify([w.data, f.data]))
        .digest("hex"),
    };
  };
  const before = await snapshot();
  const [instant, columns] = await Promise.all([
    client.rpc("instant_workspace"),
    client.from("customers").select("is_one_time").limit(0),
  ]);
  const activeTrips = [];
  for (const t of before.data.trips.filter(
    (t) => t.driver_id === auth.data.user.id && t.status === "ACTIVE",
  )) {
    const scoped = await client.rpc("operations_workspace", { p_trip: t.id });
    if (scoped.error)
      throw new Error("Authorized trip stock could not be checked.");
    activeTrips.push({
      status: t.status,
      dayOpen: before.data.days.some(
        (d) => d.id === t.business_day_id && d.status === "OPEN",
      ),
      carryoverPending: t.carryover_pending === true,
      hasAssignedStock: scoped.data.loads.some(
        (l) => l.trip_id === t.id && l.quantity > 0,
      ),
    });
  }
  console.log(
    JSON.stringify({
      role,
      instantRpc: {
        status: instant.status,
        code: instant.error?.code ?? null,
        records: instant.data?.records?.length ?? null,
      },
      customerColumn: {
        status: columns.status,
        code: columns.error?.code ?? null,
      },
      activeTrips,
      businessSnapshotUnchanged: before.hash === (await snapshot()).hash,
    }),
  );
  if (
    process.argv.includes("--expect-installed") &&
    (instant.error || columns.error)
  )
    throw new Error("Instant Delivery schema checks failed.");
  await client.auth.signOut({ scope: "local" });
}
