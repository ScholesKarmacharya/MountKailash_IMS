import { createClient } from "@supabase/supabase-js";

// Deliberately refuses remote projects; never print passwords or keys.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
if (
  !url ||
  !["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname)
) {
  throw new Error("Demo seed is restricted to a local Supabase URL.");
}
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!key)
  throw new Error("Set the local SUPABASE_SERVICE_ROLE_KEY in .env.local.");
const accounts = [
  {
    email: "admin@mount-kailash.example",
    name: "DEMO Warehouse Admin",
    role: "ADMIN",
    password: process.env.DEMO_ADMIN_PASSWORD,
  },
  {
    email: "driver@mount-kailash.example",
    name: "DEMO Delivery Driver",
    role: "DRIVER",
    password: process.env.DEMO_DRIVER_PASSWORD,
  },
];
for (const account of accounts) {
  if (!account.password || account.password.length < 12)
    throw new Error(
      "Set both DEMO passwords to unique local values of at least 12 characters.",
    );
}
const client = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const checked = (result) => {
  if (result.error)
    throw new Error(
      "Demo seed operation failed. Check local Supabase and migration status.",
    );
  return result.data;
};
// Local demo projects are small; paginate to make reruns deterministic.
const users = [];
for (let page = 1; ; page++) {
  const { users: batch } = checked(
    await client.auth.admin.listUsers({ page, perPage: 100 }),
  );
  users.push(...batch);
  if (batch.length < 100) break;
}
for (const account of accounts) {
  let user = users.find((candidate) => candidate.email === account.email);
  if (!user)
    user = checked(
      await client.auth.admin.createUser({
        email: account.email,
        password: account.password,
        email_confirm: true,
      }),
    ).user;
  // Reruns retain existing passwords; seed never silently changes credentials.
  checked(
    await client.from("profiles").upsert({
      id: user.id,
      name: account.name,
      role: account.role,
      is_active: true,
    }),
  );
}
console.log(
  "Local DEMO admin and driver profiles are ready. No stock, money, trips or business days were fabricated.",
);
