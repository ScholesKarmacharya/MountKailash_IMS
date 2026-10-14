import { createClient } from "@supabase/supabase-js";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key || !process.env.DEMO_DRIVER_PASSWORD)
  throw new Error("Existing driver diagnostic credentials are required.");
const requests = [];
const client = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: {
    fetch: async (input, init) => {
      const response = await fetch(input, init);
      if (String(input).includes("/rest/v1/rpc/")) {
        const body = await response.clone().json();
        requests.push({
          method: init?.method,
          url: String(input),
          status: response.status,
          error: response.ok
            ? null
            : {
                code: body.code,
                message: body.message,
                details: body.details,
                hint: body.hint,
              },
        });
      }
      return response;
    },
  },
});
const { data: auth, error: signInError } = await client.auth.signInWithPassword(
  {
    email: process.env.DEMO_DRIVER_EMAIL ?? "driver@mount-kailash.example",
    password: process.env.DEMO_DRIVER_PASSWORD,
  },
);
if (signInError || !auth.user)
  throw new Error(
    `Existing driver sign-in failed (${signInError?.status ?? "unknown"}).`,
  );
const { data: profile, error: profileError } = await client
  .from("profiles")
  .select("id,role,is_active,approval_status")
  .eq("id", auth.user.id)
  .single();
console.log(JSON.stringify({ profile, error: profileError?.code ?? null }));
const { data: w, error: workspaceError } = await client.rpc(
  "operations_workspace",
  { p_trip: null },
);
if (workspaceError)
  throw new Error(`Workspace failed (${workspaceError.code}).`);
const trip =
  w.trips.find((t) => t.status === "ACTIVE") ??
  w.trips.find((t) => t.status === "LOADED");
if (!trip)
  throw new Error(
    "No existing active/loaded trip available; no trip will be created.",
  );
for (const c of w.customers.filter((c) => c.is_active)) {
  const { data, error } = await client.rpc("delivery_customer_context", {
    p_trip: trip.id,
    p_customer: c.id,
  });
  console.log(
    JSON.stringify({
      customer: c.id,
      type: c.supply_type,
      status: c.house_status,
      error: error ? { code: error.code, message: error.message } : null,
      context: data
        ? {
            customer: data.customer.id,
            prices: data.prices.length,
            custody: data.custody.length,
            credit: data.credit.length,
            houseProducts: data.house_products?.length,
          }
        : null,
    }),
  );
}
const { data: offline, error: offlineError } = await client.rpc(
  "offline_contexts",
  { p_trip: trip.id },
);
console.log(
  JSON.stringify({
    offlineContexts: offline?.length,
    error: offlineError
      ? { code: offlineError.code, message: offlineError.message }
      : null,
  }),
);
console.log(JSON.stringify({ requests }, null, 2));
if (process.env.DEMO_ADMIN_PASSWORD) {
  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const signedIn = await admin.auth.signInWithPassword({
    email: process.env.DEMO_ADMIN_EMAIL ?? "admin@mount-kailash.example",
    password: process.env.DEMO_ADMIN_PASSWORD,
  });
  if (signedIn.error)
    throw new Error(
      `Existing admin sign-in failed (${signedIn.error.status}).`,
    );
  const report = await admin.rpc("house_workspace", {
    p_start: "2000-01-01T00:00:00Z",
    p_end: "2100-01-01T00:00:00Z",
    p_customer: null,
    p_driver: null,
    p_product: null,
  });
  console.log(
    JSON.stringify({
      request: "POST /rest/v1/rpc/house_workspace",
      status: report.status,
      error: report.error
        ? { code: report.error.code, message: report.error.message }
        : null,
      confirmedRows: report.data?.rows?.length ?? null,
    }),
  );
}
