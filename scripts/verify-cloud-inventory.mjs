import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { chromium, expect } from "@playwright/test";

// Read-only business verification; only Auth sign-in/out and denied driver RPCs.
// No artifacts, traces, tokens, passwords or raw provider diagnostics are printed.
const baseURL = process.argv[2] || "http://localhost:3000";
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
for (const role of ["ADMIN", "DRIVER"])
  if (!process.env[`DEMO_${role}_PASSWORD`])
    throw new Error(`${role} password is missing from the saved environment.`);
const clients = [];
let browser;
let stage = "Cloud sign-in";
function checked(result) {
  if (result.error) throw new Error("Cloud query failed.");
  return result.data;
}
async function session(role) {
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) =>
        fetch(input, { ...init, signal: AbortSignal.timeout(20000) }),
    },
  });
  clients.push(client);
  const { user } = checked(
    await client.auth.signInWithPassword({
      email: `${role.toLowerCase()}@mount-kailash.example`,
      password: process.env[`DEMO_${role}_PASSWORD`],
    }),
  );
  const profile = checked(
    await client
      .from("profiles")
      .select("role,is_active")
      .eq("id", user.id)
      .single(),
  );
  if (profile.role !== role || !profile.is_active)
    throw new Error("Role check failed.");
  return client;
}
async function all(client, table, columns, order) {
  const rows = [];
  for (let offset = 0; ; offset += 500) {
    let query = client.from(table).select(columns);
    for (const field of order) query = query.order(field);
    const chunk = checked(await query.range(offset, offset + 499));
    rows.push(...chunk);
    if (chunk.length < 500) return rows;
  }
}
async function snapshot(client) {
  const location = checked(
    await client
      .from("stock_locations")
      .select("id")
      .eq("code", "MAIN")
      .eq("kind", "WAREHOUSE")
      .single(),
  );
  const balances = (
    await all(
      client,
      "inventory_balances",
      "location_id,product_id,stock_kind,quantity,version",
      ["location_id", "product_id", "stock_kind"],
    )
  ).filter((b) => b.location_id === location.id);
  const adjustments = await all(
    client,
    "stock_adjustments",
    "id,delta,reason,quantity_before,quantity_after,stock_movements!inner(id,product_id,stock_kind,actor_user_id,business_day_id,from_location_id,to_location_id,profiles!stock_movements_actor_user_id_fkey(name),business_days!stock_movements_business_day_id_fkey(date_label))",
    ["id"],
  );
  const audits = await all(client, "audit_events", "entity_id,action,entity", [
    "id",
  ]);
  for (const entry of adjustments)
    if (
      entry.quantity_after !== entry.quantity_before + entry.delta ||
      !audits.some(
        (e) =>
          e.entity_id === entry.id &&
          e.entity === "stock_adjustments" &&
          e.action === "STOCK_ADJUSTED",
      )
    )
      throw new Error("Ledger integrity failed.");
  const totals = { FULL_JAR: 0, EMPTY_JAR: 0, BOTTLE_CARTON: 0 };
  for (const balance of balances) {
    if (balance.quantity < 0) throw new Error("Negative stock.");
    totals[balance.stock_kind] += balance.quantity;
  }
  return {
    warehouseId: location.id,
    balances,
    adjustmentCount: adjustments.length,
    totals,
  };
}
async function login(page, role) {
  await page.goto(`${baseURL}/sign-in`);
  await page
    .getByLabel("Email address")
    .fill(`${role.toLowerCase()}@mount-kailash.example`);
  await page
    .getByLabel("Password", { exact: true })
    .fill(process.env[`DEMO_${role}_PASSWORD`]);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(
    (u) =>
      u.pathname === (role === "ADMIN" ? "/admin/dashboard" : "/driver/home"),
  );
}
async function displayedStock(page, totals) {
  const region = page.getByRole("region", {
    name: "Warehouse stock",
    exact: true,
  });
  await region.waitFor();
  for (const [kind, label] of [
    ["FULL_JAR", "Full jars"],
    ["EMPTY_JAR", "Empty jars"],
    ["BOTTLE_CARTON", "Water cartons"],
  ]) {
    const card = region
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: label, exact: true }) });
    await expect(card.locator("p").first()).toHaveText(
      totals[kind].toLocaleString("en-NP"),
    );
  }
}
try {
  const admin = await session("ADMIN");
  stage = "Cloud inventory query and joined history";
  const before = await snapshot(admin);
  console.log(
    `Cloud warehouse quantities: full jars ${before.totals.FULL_JAR}; empty jars ${before.totals.EMPTY_JAR}; water cartons ${before.totals.BOTTLE_CARTON}.`,
  );
  console.log(
    `Existing adjustment ledger: ${before.adjustmentCount} entries; integrity verified.`,
  );
  const days = checked(
    await admin
      .from("business_days")
      .select("id,status")
      .in("status", ["OPEN", "CLOSING_REVIEW"]),
  );
  const driver = await session("DRIVER");
  stage = "Driver RLS and direct RPC denial";
  // Sprint 2 legitimately exposes assigned products, vehicle balances, trip
  // movements and trip audits. Check warehouse/manual scope specifically.
  for (const query of [
    driver
      .from("stock_locations")
      .select("id", { head: true, count: "exact" })
      .eq("kind", "WAREHOUSE"),
    driver
      .from("inventory_balances")
      .select("product_id", { head: true, count: "exact" })
      .eq("location_id", before.warehouseId),
    driver
      .from("stock_movements")
      .select("id", { head: true, count: "exact" })
      .in("movement_type", ["MANUAL_INCREASE", "MANUAL_DECREASE"]),
    driver
      .from("stock_adjustments")
      .select("id", { head: true, count: "exact" }),
    driver
      .from("audit_events")
      .select("id", { head: true, count: "exact" })
      .eq("entity", "stock_adjustments"),
  ]) {
    const result = await query;
    if (result.error || result.count !== 0)
      throw new Error("Driver reads global stock.");
  }
  stage = "Driver stock RPC denial";
  const denied = await driver.rpc("adjust_warehouse_stock", {
    p_product: randomUUID(),
    p_kind: "FULL_JAR",
    p_delta: 1,
    p_reason: "Authorization verification",
    p_notes: "",
    p_day: randomUUID(),
    p_key: randomUUID(),
  });
  if (denied.error?.code !== "42501")
    throw new Error("Driver RPC was not denied by permission check.");
  stage = "Driver direct balance-update denial";
  const direct = await driver
    .from("inventory_balances")
    .update({ quantity: 999 })
    .eq("product_id", randomUUID());
  if (direct.error?.code !== "42501")
    throw new Error("Driver direct update was not denied.");
  console.log(
    "Driver Cloud RLS, stock RPC and direct balance-update denial passed.",
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
      stage = `Admin stock display at ${viewport.width}px`;
      await login(page, "ADMIN");
      await displayedStock(page, before.totals);
      await page.reload();
      await displayedStock(page, before.totals);
      await page.goto(`${baseURL}/admin/inventory`);
      await displayedStock(page, before.totals);
      if (!days.length) {
        await expect(
          page.getByRole("button", { name: "Open business day", exact: true }),
        ).toBeVisible();
        // Exercise the real confirmation path safely; opening itself was tested
        // by the rollback-only SQL transaction, never by committing a test day.
        page.once("dialog", (dialog) => dialog.dismiss());
        await page
          .getByRole("button", { name: "Open business day", exact: true })
          .click();
        await expect(
          page.getByRole("button", { name: "Open business day", exact: true }),
        ).toBeEnabled();
      } else if (days[0].status === "OPEN")
        await expect(
          page.getByText("Posting to business day", { exact: false }),
        ).toBeVisible();
      if (
        !(await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ))
      )
        throw new Error("Layout overflow.");
      stage = "Stock after sign-out and reauthentication";
      await page.getByRole("button", { name: "Sign Out", exact: true }).click();
      await page.waitForURL((u) => u.pathname === "/sign-in");
      await login(page, "ADMIN");
      await displayedStock(page, before.totals);
      await page.getByRole("button", { name: "Sign Out", exact: true }).click();
      await page.waitForURL((u) => u.pathname === "/sign-in");
      await login(page, "DRIVER");
      for (const route of [
        "/admin/dashboard",
        "/admin/products",
        "/admin/inventory",
      ]) {
        await page.goto(`${baseURL}${route}`);
        await page.waitForURL((u) => u.pathname === "/driver/home");
      }
      await page.getByRole("button", { name: "Sign Out", exact: true }).click();
      await page.waitForURL((u) => u.pathname === "/sign-in");
      console.log(
        `${viewport.width}px: database/UI totals, refresh, sign-out/sign-in persistence and driver route denial passed.`,
      );
    } finally {
      await context.close();
    }
  }
  stage = "Unchanged Cloud inventory after verification";
  const after = await snapshot(admin);
  const afterDays = checked(
    await admin
      .from("business_days")
      .select("id,status")
      .in("status", ["OPEN", "CLOSING_REVIEW"]),
  );
  if (JSON.stringify(afterDays) !== JSON.stringify(days))
    throw new Error("Business-day state changed during verification.");
  if (JSON.stringify(after) !== JSON.stringify(before))
    throw new Error(
      "Inventory changed during verification; review concurrent activity.",
    );
  console.log(
    "Cloud inventory snapshot unchanged. No products, stock or business days were created by browser/API verification.",
  );
} catch {
  console.error(
    `Cloud inventory verification failed at: ${stage}. No credentials or raw diagnostics printed.`,
  );
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  for (const client of clients)
    await client.auth.signOut({ scope: "local" }).catch(() => {});
}
