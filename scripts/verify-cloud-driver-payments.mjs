import { readFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { chromium, expect } from "@playwright/test";

// Never saves a delivery, starts a trip, changes preferences or creates fixtures.
// The only posting RPC probes use an invalid status rejected before posting begins.
const base = process.argv[2] ?? "http://localhost:3000";
const target = new URL(base);
if (
  target.protocol !== "http:" ||
  !["localhost", "127.0.0.1"].includes(target.hostname)
)
  throw new Error("Use a loopback development server.");
const ref = readFileSync("supabase/.temp/project-ref", "utf8").trim();
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (url !== `https://${ref}.supabase.co` || !key)
  throw new Error("Environment must match the linked Cloud project.");
const ne = JSON.parse(readFileSync("src/lib/i18n/ne.json", "utf8"));
const clients = [];
const sessions = new Map();
let browser,
  stage = "authentication";
async function snapshot(client) {
  const [operations, finance] = await Promise.all([
    client.rpc("operations_workspace", { p_trip: null }),
    client.rpc("finance_workspace"),
  ]);
  if (operations.error || finance.error)
    throw new Error("Workspace read failed.");
  return createHash("sha256")
    .update(JSON.stringify([operations.data, finance.data]))
    .digest("hex");
}
try {
  for (const role of ["ADMIN", "DRIVER"]) {
    const password = process.env[`DEMO_${role}_PASSWORD`];
    if (!password) throw new Error("Demo credentials missing.");
    const client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    clients.push(client);
    const auth = await client.auth.signInWithPassword({
      email: `${role.toLowerCase()}@mount-kailash.example`,
      password,
    });
    if (auth.error || !auth.data.user)
      throw new Error("Authentication failed.");
    const profile = await client
      .from("profiles")
      .select("role,is_active")
      .eq("id", auth.data.user.id)
      .single();
    if (profile.error || profile.data.role !== role || !profile.data.is_active)
      throw new Error("Profile mismatch.");
    const locale = ["en", "ne"].includes(auth.data.user.user_metadata.locale)
      ? auth.data.user.user_metadata.locale
      : role === "DRIVER"
        ? "ne"
        : "en";
    sessions.set(role, { client, locale });
  }
  const admin = sessions.get("ADMIN").client;
  const before = await snapshot(admin);
  const invalid = {
    p_trip: "00000000-0000-0000-0000-000000000000",
    p_customer: null,
    p_walk_name: "",
    p_walk_phone: "",
    p_items: [],
    p_status: "INVALID",
    p_received: null,
    p_notes: "",
    p_key: randomUUID(),
  };
  for (const role of ["ADMIN", "DRIVER"]) {
    stage = `${role} REST validation entry point`;
    let result;
    for (let attempt = 0; attempt < 10; attempt++) {
      result = await sessions
        .get(role)
        .client.rpc("post_driver_delivery", invalid);
      if (result.error?.code !== "PGRST202") break;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    if (
      result.error?.code !== "22023" ||
      result.error.message !== "Choose Paid or Credit."
    )
      throw new Error("Unexpected RPC validation result.");
    console.log(
      `${role}: new REST function resolves and rejects invalid status before any posting.`,
    );
  }
  stage = "anonymous RPC denial";
  const anon = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const denied = await anon.rpc("post_driver_delivery", invalid);
  if (denied.error?.code !== "42501")
    throw new Error("Anonymous access was not denied.");
  console.log("Anonymous execution denied by PostgreSQL grants.");

  browser = await chromium.launch({ channel: "chromium" });
  const { locale } = sessions.get("DRIVER");
  const label = (k) => (locale === "ne" ? (ne[k] ?? k) : k);
  for (const viewport of [
    { width: 1280, height: 900 },
    { width: 393, height: 851 },
  ]) {
    const context = await browser.newContext({ viewport });
    try {
      const page = await context.newPage();
      page.setDefaultTimeout(30000);
      stage = `driver ${viewport.width}px sign-in`;
      await page.goto(`${base}/sign-in`);
      await page.getByRole("button", { name: "English", exact: true }).click();
      await page
        .getByLabel("Email address")
        .fill("driver@mount-kailash.example");
      await page
        .getByLabel("Password", { exact: true })
        .fill(process.env.DEMO_DRIVER_PASSWORD);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(page).toHaveURL(/driver\/home/);
      await expect(
        page.getByRole("heading", { name: label("My day"), exact: true }),
      ).toBeVisible();
      stage = `driver ${viewport.width}px New Delivery`;
      await page.goto(`${base}/driver/delivery`);
      await expect(
        page.getByRole("heading", { name: label("New Delivery"), exact: true }),
      ).toBeVisible();
      const form = page.locator("form").filter({
        has: page.locator('input[name="operation"][value="driver-visit"]'),
      });
      if (await form.count()) {
        const quantities = form.getByLabel(label("Jars Delivered"), {
          exact: true,
        });
        const cartons = form.getByLabel(label("Cartons Delivered"), {
          exact: true,
        });
        let changed = false;
        for (const inputs of [quantities, cartons]) {
          for (let i = 0; i < (await inputs.count()); i++) {
            if (Number(await inputs.nth(i).getAttribute("max")) > 0) {
              await inputs.nth(i).fill("1");
              changed = true;
              break;
            }
          }
          if (changed) break;
        }
        if (changed) {
          const group = form.getByRole("group", {
            name: label("Payment Status"),
            exact: true,
          });
          await expect(group.getByRole("button")).toHaveCount(2);
          const paid = group.getByRole("button", {
            name: label("Paid"),
            exact: true,
          });
          const credit = group.getByRole("button", {
            name: label("Credit"),
            exact: true,
          });
          const amount = group.getByLabel(
            label("Total Amount Received (NPR)"),
            { exact: true },
          );
          await expect(paid).toHaveAttribute("aria-pressed", "true");
          await expect(amount).toHaveAttribute("inputmode", "decimal");
          await expect(amount).toHaveValue("");
          await expect(
            form.getByRole("button", {
              name: label("Review delivery"),
              exact: true,
            }),
          ).toBeDisabled();
          await amount.fill("1.23");
          await credit.click();
          await expect(amount).toHaveCount(0);
          await expect(
            form.locator('input[name="received_amount"]'),
          ).toHaveValue("");
          await expect(group.getByRole("status")).toHaveText(label("Credit"));
          await paid.click();
          await expect(amount).toHaveValue("1.23");
          for (const button of [paid, credit]) {
            const box = await button.boundingBox();
            if (!box || box.height < 44)
              throw new Error("Touch target too small.");
          }
          for (const name of [
            "Cash",
            "Fonepay",
            "Monthly credit / unpaid",
            "Partial payment",
          ])
            await expect(
              form.getByRole("button", { name: label(name), exact: true }),
            ).toHaveCount(0);
          await expect(
            form.getByLabel(label("Transaction reference (unverified)"), {
              exact: true,
            }),
          ).toHaveCount(0);
          console.log(
            `Driver ${viewport.width}px: Paid/Credit controls, required decimal input, draft switching and touch targets passed; no delivery submitted.`,
          );
        } else
          console.log(
            `Driver ${viewport.width}px: active form loaded; no positive loaded stock available for a payment draft. No stock created.`,
          );
      } else
        console.log(
          `Driver ${viewport.width}px: delivery waiting/return state loaded; no eligible active form. No trip started or created.`,
        );
      if (
        !(await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ))
      )
        throw new Error("Layout overflow.");
    } finally {
      await context.close();
    }
  }
  stage = "business preservation";
  if (before !== (await snapshot(admin)))
    throw new Error("Business snapshot changed during verification.");
  console.log(
    "Cloud business workspace snapshots unchanged. No business records, saved preferences or browser artifacts created.",
  );
} catch {
  console.error(
    `Cloud driver payment verification failed at: ${stage}. No private diagnostics printed.`,
  );
  process.exitCode = 1;
} finally {
  await browser?.close();
  for (const client of clients) await client.auth.signOut({ scope: "local" });
}
