import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { chromium, expect } from "@playwright/test";

// Cloud business data stays read-only. Auth sign-in/out is the only mutation.
// Raw errors, tokens, credentials and browser artifacts are never printed.
const inspect = process.argv.includes("--inspect");
const baseURL =
  process.argv.find((arg) => arg.startsWith("http://")) ||
  "http://localhost:3000";
const target = new URL(baseURL);
const ref = readFileSync("supabase/.temp/project-ref", "utf8").trim();
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (!/^[a-z0-9]{20}$/.test(ref) || url !== `https://${ref}.supabase.co` || !key)
  throw new Error("Environment must match the linked Cloud project.");
if (
  target.protocol !== "http:" ||
  !["localhost", "127.0.0.1", "[::1]"].includes(target.hostname)
)
  throw new Error("Browser verification requires a loopback application URL.");
const clients = [];
let browser;
let stage = "Cloud authentication";
async function session(role) {
  const password = process.env[`DEMO_${role}_PASSWORD`];
  if (!password) throw new Error("Demo password is missing.");
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) =>
        fetch(input, { ...init, signal: AbortSignal.timeout(20000) }),
    },
  });
  clients.push(client);
  const result = await client.auth.signInWithPassword({
    email: `${role.toLowerCase()}@mount-kailash.example`,
    password,
  });
  if (result.error || !result.data.user) throw new Error("Auth check failed.");
  const profile = await client
    .from("profiles")
    .select("role,is_active")
    .eq("id", result.data.user.id)
    .single();
  if (profile.error || profile.data.role !== role || !profile.data.is_active)
    throw new Error("Profile check failed.");
  return client;
}
try {
  const admin = await session("ADMIN");
  stage = "operations_workspace RPC";
  const result = await admin.rpc("operations_workspace", { p_trip: null });
  if (inspect) {
    console.log(
      result.error
        ? `Admin workspace RPC error code: ${result.error.code}; no raw diagnostics printed.`
        : "Admin workspace RPC exists and is readable.",
    );
  } else {
    if (result.error || !result.data) throw new Error("Workspace unavailable.");
    const workspace = result.data;
    if (workspace.driver_workflow !== true)
      throw new Error("Driver workflow migration unavailable.");
    stage = "Cloud customer directory and pending-jar readers";
    const directory = await admin.rpc("delivery_customer_directory");
    const pending = await admin.rpc("pending_jar_workspace");
    if (
      directory.error ||
      !Array.isArray(directory.data) ||
      pending.error ||
      !Array.isArray(pending.data?.rows)
    )
      throw new Error("New Cloud readers unavailable.");
    expect(directory.data.map((c) => c.id).sort()).toEqual(
      workspace.customers.map((c) => c.id).sort(),
    );
    console.log(
      `Cloud driver workflow enabled; contact directory and ${pending.data.rows.length} pending-jar lots readable.`,
    );
    console.log(
      `Cloud workspace: ${workspace.customers.length} customers, ${workspace.vehicles.length} vehicles, ${workspace.drivers.length} driver profiles, ${workspace.trips.length} listed trips.`,
    );
    const driver = await session("DRIVER");
    const own = await driver.rpc("operations_workspace", { p_trip: null });
    const identity = await driver.auth.getUser();
    if (
      own.error ||
      !own.data ||
      own.data.driver_workflow !== true ||
      identity.error ||
      own.data.trips.some((t) => t.driver_id !== identity.data.user.id)
    )
      throw new Error("Driver workspace unavailable.");
    const eligible = own.data.trips.find(
      (t) =>
        t.status === "ACTIVE" &&
        own.data.days.some(
          (d) => d.id === t.business_day_id && d.status === "OPEN",
        ),
    );
    const driverPending = await driver.rpc("pending_jar_workspace", {
      p_trip: eligible?.id ?? null,
    });
    if (
      eligible
        ? driverPending.error || !Array.isArray(driverPending.data?.rows)
        : driverPending.error?.code !== "42501"
    )
      throw new Error("Driver pending-jar scope failed.");
    console.log(
      eligible
        ? "Assigned active-trip pending-jar read passed."
        : "Pending-jar reads correctly denied without an ACTIVE assigned trip on an OPEN day.",
    );
    const warehouse = await driver
      .from("stock_locations")
      .select("id")
      .eq("kind", "WAREHOUSE");
    if (warehouse.error || warehouse.data.length !== 0)
      throw new Error("Driver warehouse scope failed.");
    console.log(
      "Driver workspace readable; warehouse locations hidden by RLS.",
    );
    browser = await chromium.launch({ channel: "chromium" });
    for (const viewport of [
      { width: 1280, height: 900 },
      { width: 393, height: 851 },
    ]) {
      const context = await browser.newContext({ viewport });
      try {
        const page = await context.newPage();
        page.setDefaultTimeout(30000);
        await page.goto(`${baseURL}/sign-in`);
        await page
          .getByLabel("Email address")
          .fill("admin@mount-kailash.example");
        await page
          .getByLabel("Password", { exact: true })
          .fill(process.env.DEMO_ADMIN_PASSWORD);
        await page
          .getByRole("button", { name: "Sign in", exact: true })
          .click();
        await page.waitForURL((u) => u.pathname === "/admin/dashboard");
        for (const [collection, heading, empty] of [
          ["customers", "Customers", "No matching customers."],
          ["vehicles", "Vehicles", "No matching vehicles."],
          ["drivers", "Drivers", "No matching drivers."],
          ["trips", "Trips", "No assigned trips."],
        ]) {
          stage = `${heading} ${viewport.width}px Cloud page`;
          await page.goto(`${baseURL}/admin/${collection}`);
          await expect(
            page.getByRole("heading", { name: heading, exact: true }),
          ).toBeVisible();
          await expect(
            page.getByText(/Sprint 2 migrations are required/),
          ).toHaveCount(0);
          const rows = workspace[collection];
          const links = page.locator(`main a[href^="/admin/${collection}/"]`);
          await expect(links).toHaveCount(rows.length);
          if (rows.length === 0)
            await expect(page.getByText(empty, { exact: true })).toBeVisible();
          expect(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
          ).toBe(true);
          await page.reload();
          await expect(links).toHaveCount(rows.length);
        }
        stage = `Pending-jar report ${viewport.width}px Cloud page`;
        await page.goto(`${baseURL}/admin/reports`);
        await expect(
          page.getByRole("heading", { name: "Daily history", exact: true }),
        ).toBeVisible();
        const pendingRegion = page.locator("#pending-jars");
        await expect(
          pendingRegion.getByRole("heading", {
            name: "Current pending jars (carry-forward)",
            exact: true,
          }),
        ).toBeVisible();
        await expect(
          page.getByText(/migrations? (?:is|are) required/),
        ).toHaveCount(0);
        await expect(pendingRegion.locator("li")).toHaveCount(
          pending.data.rows.length,
        );
        if (!pending.data.rows.length)
          await expect(
            pendingRegion.getByText("No pending jars.", { exact: true }),
          ).toBeVisible();
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        await page.reload();
        await expect(pendingRegion.locator("li")).toHaveCount(
          pending.data.rows.length,
        );
        await page
          .getByRole("button", { name: "Sign out", exact: true })
          .click();
        await page.waitForURL((u) => u.pathname === "/sign-in");
        console.log(
          `All four admin directories and pending-jar report: real Cloud row counts, empty states, refresh and responsive layout passed at ${viewport.width}px.`,
        );
      } finally {
        await context.close();
      }
    }
  }
} catch {
  console.error(
    `Cloud operations verification failed at: ${stage}. No credentials or page contents printed.`,
  );
  process.exitCode = 1;
} finally {
  await browser?.close();
  await Promise.allSettled(
    clients.map((client) => client.auth.signOut({ scope: "local" })),
  );
}
