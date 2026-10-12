import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

// Explicit, limited Cloud provisioning tool. Never used by application routes.
// CLI stdout/stderr containing credentials is captured, never forwarded.
const creating = process.argv.includes("--create");
const ref = readFileSync("supabase/.temp/project-ref", "utf8").trim();
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
if (!/^[a-z0-9]{20}$/.test(ref) || url !== `https://${ref}.supabase.co`) {
  throw new Error("Cloud URL must exactly match the linked Supabase project.");
}
const publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (!publicKey) throw new Error("Public Supabase key is missing.");

function checked(result, operation) {
  if (result.error) {
    // Provider messages may contain personal details. Do not echo them.
    throw new Error(
      `${operation} failed (status ${result.error.status ?? "unavailable"}).`,
    );
  }
  return result.data;
}

function adminKey() {
  if (process.env.SUPABASE_SERVICE_ROLE_KEY)
    return process.env.SUPABASE_SERVICE_ROLE_KEY;
  const args = [
    "--no-install",
    "supabase",
    "projects",
    "api-keys",
    "--project-ref",
    ref,
    "--reveal",
    "--output",
    "json",
    "--agent",
    "no",
  ];
  let payload;
  try {
    const raw =
      process.platform === "win32"
        ? execFileSync(
            process.env.ComSpec || "cmd.exe",
            ["/d", "/s", "/c", `npx.cmd ${args.join(" ")}`],
            {
              encoding: "utf8",
              stdio: ["ignore", "pipe", "pipe"],
              timeout: 60000,
            },
          )
        : execFileSync("npx", args, {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
            timeout: 60000,
          });
    payload = JSON.parse(raw);
  } catch {
    throw new Error(
      "Could not obtain trusted admin access from your logged-in Supabase CLI. Set a server-only admin key privately in .env.local instead.",
    );
  }
  const keys = Array.isArray(payload)
    ? payload
    : (payload.api_keys ?? payload.keys ?? payload.data);
  if (!Array.isArray(keys))
    throw new Error(
      "Unexpected API-key response; credentials were not printed.",
    );
  const entry =
    keys.find((key) => key.name === "service_role") ??
    keys.find((key) => key.type === "secret");
  const value = entry?.api_key ?? entry?.key;
  if (!value || value.includes("***"))
    throw new Error(
      "No usable admin key available. Credentials were not printed.",
    );
  return value;
}

async function main() {
  const settingsResponse = await fetch(`${url}/auth/v1/settings`, {
    headers: { apikey: publicKey },
    signal: AbortSignal.timeout(15000),
  });
  if (!settingsResponse.ok)
    throw new Error(
      `Public Auth configuration check failed (status ${settingsResponse.status}).`,
    );
  const settings = await settingsResponse.json();
  console.log(
    `Cloud email/password enabled: ${settings.external?.email === true}`,
  );
  console.log(
    `Cloud public signup disabled: ${settings.disable_signup === true}`,
  );
  console.log(
    `Cloud email confirmation required: ${settings.mailer_autoconfirm === false}`,
  );

  const client = createClient(url, adminKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) =>
        fetch(input, { ...init, signal: AbortSignal.timeout(20000) }),
    },
  });
  checked(
    await client.from("profiles").select("id", { head: true, count: "exact" }),
    "Profiles schema check",
  );
  checked(
    await client
      .from("business_days")
      .select("id", { head: true, count: "exact" }),
    "Business-day schema check",
  );
  console.log(
    "Cloud profiles and business_days tables are readable by trusted tooling.",
  );

  const users = [];
  for (let page = 1; ; page++) {
    const batch = checked(
      await client.auth.admin.listUsers({ page, perPage: 100 }),
      "Account inspection",
    ).users;
    users.push(...batch);
    if (batch.length < 100) break;
  }
  const accounts = [
    {
      email: "admin@mount-kailash.example",
      name: "DEMO Warehouse Admin",
      role: "ADMIN",
      passwordKey: "DEMO_ADMIN_PASSWORD",
    },
    {
      email: "driver@mount-kailash.example",
      name: "DEMO Delivery Driver",
      role: "DRIVER",
      passwordKey: "DEMO_DRIVER_PASSWORD",
    },
  ];
  // Preflight both identities before any changes; never re-enable or promote an
  // existing user whose profile conflicts with the intended demo identity.
  for (const account of accounts) {
    account.user = users.find((user) => user.email === account.email);
    if (account.user) {
      account.profile = checked(
        await client
          .from("profiles")
          .select("id,name,role,is_active")
          .eq("id", account.user.id)
          .maybeSingle(),
        "Demo profile inspection",
      );
      if (
        account.profile &&
        (account.profile.role !== account.role || !account.profile.is_active)
      )
        throw new Error(
          `${account.role} demo profile conflicts with requested access; no existing profile was overwritten.`,
        );
    }
    console.log(
      `${account.role} demo: Auth identity ${account.user ? "exists" : "missing"}; profile ${account.profile ? "ready" : "missing"}.`,
    );
  }
  if (!creating) {
    console.log(
      "Read-only inspection complete. Run with --create only to provision the two requested DEMO identities.",
    );
    return;
  }

  let env = readFileSync(".env.local", "utf8");
  for (const account of accounts) {
    if (!account.user && !process.env[account.passwordKey]) {
      const password = `Mk!9${randomBytes(24).toString("base64url")}`;
      process.env[account.passwordKey] = password;
      const lines = env.split(/\r?\n/);
      const index = lines.findIndex((line) =>
        line.startsWith(`${account.passwordKey}=`),
      );
      if (index >= 0) lines[index] = `${account.passwordKey}=${password}`;
      else lines.push(`${account.passwordKey}=${password}`);
      env = lines.join("\n");
    }
    const password = process.env[account.passwordKey];
    if (password && password.length < 12)
      throw new Error(
        `${account.passwordKey} must contain at least 12 characters. No account passwords were changed.`,
      );
    if (account.user && !password)
      throw new Error(
        `Existing ${account.role} demo password is not available. Set the known password privately in .env.local; this tool will not reset it.`,
      );
  }
  // Save before creating users so credentials remain recoverable after a partial
  // network failure. Never save privileged Cloud keys obtained through the CLI.
  writeFileSync(".env.local", env, { mode: 0o600 });
  for (const account of accounts) {
    if (!account.user) {
      account.user = checked(
        await client.auth.admin.createUser({
          email: account.email,
          password: process.env[account.passwordKey],
          email_confirm: true,
        }),
        `${account.role} demo account creation`,
      ).user;
      if (!account.user)
        throw new Error(`${account.role} demo identity was not returned.`);
    }
    if (!account.profile)
      checked(
        await client.from("profiles").insert({
          id: account.user.id,
          name: account.name,
          role: account.role,
          is_active: account.role === "ADMIN",
        }),
        `${account.role} demo profile creation`,
      );
    const sessionClient = createClient(url, publicKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    try {
      const auth = checked(
        await sessionClient.auth.signInWithPassword({
          email: account.email,
          password: process.env[account.passwordKey],
        }),
        `${account.role} credential verification`,
      );
      const profile = checked(
        await sessionClient
          .from("profiles")
          .select("role,is_active")
          .eq("id", auth.user.id)
          .single(),
        `${account.role} profile access verification`,
      );
      if (
        profile.role !== account.role ||
        (account.role === "ADMIN" && !profile.is_active)
      )
        throw new Error(`${account.role} profile verification failed.`);
      if (account.role === "DRIVER" && !profile.is_active) {
        console.log(
          "DRIVER: credentials verified; operational access awaits admin approval in Drivers.",
        );
        continue;
      }
      const days = await sessionClient.from("business_days").select("id");
      if (days.error || (account.role === "DRIVER" && days.data.length !== 0))
        throw new Error(
          `${account.role} business-day read permissions failed verification.`,
        );
      console.log(
        `${account.role}: credentials, active profile and business-day read permissions verified.`,
      );
    } finally {
      await sessionClient.auth.signOut({ scope: "local" });
    }
  }
  console.log(
    "Cloud DEMO accounts checked. New drivers require admin approval in Drivers. Passwords are in ignored .env.local; no passwords, tokens or privileged keys were printed.",
  );
}
main().catch((error) => {
  console.error(
    error.message.startsWith("fetch")
      ? "Cloud connection failed. No credentials were printed."
      : error.message,
  );
  process.exitCode = 1;
});
