import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { chromium, expect } from "@playwright/test";
import { adToBs, bsToAdIso, daysInBsMonth } from "@inicrea/bikram-sambat-core";
// Cloud business data is read-only. An explicit --save-current-preference flag
// also saves the demo user's current display language without changing its
// effective value. No fixtures, passwords, tokens or browser artifacts are logged.
const savePreference = process.argv.includes("--save-current-preference");
const base = process.argv[2] ?? "http://localhost:3000",
  target = new URL(base);
if (
  target.protocol !== "http:" ||
  !["localhost", "127.0.0.1"].includes(target.hostname)
)
  throw new Error("Use a loopback development server.");
const reference = readFileSync("supabase/.temp/project-ref", "utf8").trim();
const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
  key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (url !== `https://${reference}.supabase.co` || !key)
  throw new Error("Environment must match the linked Cloud project.");
const translations = JSON.parse(readFileSync("src/lib/i18n/ne.json", "utf8"));
const clients = [],
  sessions = new Map();
let browser,
  stage = "authentication";
const hash = (x) =>
  createHash("sha256").update(JSON.stringify(x)).digest("hex");
async function snapshot(client) {
  const [a, b] = await Promise.all([
    client.rpc("operations_workspace", { p_trip: null }),
    client.rpc("finance_workspace"),
  ]);
  if (a.error || b.error) throw new Error("Workspace read failed.");
  return {
    hash: hash([a.data, b.data]),
    warehouse: a.data.balances.filter(
      (b) =>
        b.location_id === a.data.locations.find((l) => l.code === "MAIN")?.id,
    ),
  };
}
try {
  for (const role of ["ADMIN", "DRIVER"]) {
    const password = process.env[`DEMO_${role}_PASSWORD`];
    if (!password) throw new Error("Demo password is missing.");
    const client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    clients.push(client);
    const login = await client.auth.signInWithPassword({
      email: `${role.toLowerCase()}@mount-kailash.example`,
      password,
    });
    if (login.error || !login.data.user)
      throw new Error("Authentication failed.");
    const p = await client
      .from("profiles")
      .select("id,role,is_active")
      .eq("id", login.data.user.id)
      .single();
    if (p.error || p.data.role !== role || !p.data.is_active)
      throw new Error("Profile verification failed.");
    const value = login.data.user.user_metadata.locale,
      locale = ["en", "ne"].includes(value)
        ? value
        : role === "DRIVER"
          ? "ne"
          : "en";
    sessions.set(role, { client, locale, id: p.data.id });
  }
  const before = await snapshot(sessions.get("ADMIN").client);
  browser = await chromium.launch({ channel: "chromium" });
  for (const viewport of [
    { width: 1280, height: 900 },
    { width: 393, height: 851 },
  ].filter((v) => !process.argv.includes("--mobile") || v.width === 393))
    for (const role of ["ADMIN", "DRIVER"].filter(
      (r) => !process.argv.includes("--driver") || r === "DRIVER",
    )) {
      const { locale } = sessions.get(role),
        label = (k) => (locale === "ne" ? (translations[k] ?? k) : k);
      const context = await browser.newContext({ viewport });
      try {
        const page = await context.newPage();
        page.setDefaultTimeout(30000);
        stage = `${role} ${viewport.width}px login`;
        await page.goto(`${base}/sign-in`);
        await page
          .getByRole("button", { name: "English", exact: true })
          .click();
        await page
          .getByLabel("Email address")
          .fill(`${role.toLowerCase()}@mount-kailash.example`);
        await page
          .getByLabel("Password", { exact: true })
          .fill(process.env[`DEMO_${role}_PASSWORD`]);
        await page
          .getByRole("button", { name: "Sign in", exact: true })
          .click();
        await expect(page).toHaveURL(
          role === "ADMIN" ? /admin\/dashboard/ : /driver\/home/,
        );
        await expect(
          page.getByRole("heading", {
            name: label(role === "ADMIN" ? "Operations dashboard" : "My day"),
            exact: true,
          }),
        ).toBeVisible();
        if (savePreference) {
          stage = `${role} current display preference save`;
          const response = page.waitForResponse(
            (r) =>
              r.url().endsWith("/api/preferences") &&
              r.request().method() === "POST",
          );
          await page
            .getByRole("button", {
              name: locale === "en" ? "English" : "नेपाली",
              exact: true,
            })
            .click();
          const status = (await response).status();
          stage += ` HTTP ${status}`;
          expect(status).toBe(200);
          stage = `${role} preference after refresh`;
          await page.reload();
          await expect(
            page.getByRole("button", {
              name: locale === "en" ? "English" : "नेपाली",
              exact: true,
            }),
          ).toHaveAttribute("aria-pressed", "true");
          stage = `${role} Auth preference metadata`;
          const saved = await sessions.get(role).client.auth.getUser();
          expect(saved.data.user?.id).toBe(sessions.get(role).id);
          expect(saved.data.user?.user_metadata.locale).toBe(locale);
        }
        const pages =
          role === "ADMIN"
            ? [
                ["dashboard", "Operations dashboard"],
                ["products", "Products"],
                ["inventory", "Warehouse inventory"],
                ["refilling", "Refilling and damaged jars"],
                ["trips", "Trips"],
                ["customers", "Customers"],
                ["vehicles", "Vehicles"],
                ["drivers", "Drivers"],
                ["payments", "Payments"],
                ["credit", "Customer credit"],
                ["billing", "Billing settings"],
                ["daily-close", "Daily closing"],
                ["reports", "Daily history"],
              ]
            : [
                ["home", "My day"],
                ["delivery", "New Delivery"],
                ["customers", "Customers"],
                ["pending-jars", "Pending Jars"],
                ["sales", "Sales History"],
                ["return", "Return to Warehouse"],
              ];
        for (const [route, title] of pages) {
          stage = `${role} ${viewport.width}px ${route}`;
          await page.goto(`${base}/${role.toLowerCase()}/${route}`);
          await expect(
            page
              .getByRole("heading", { name: label(title), exact: true })
              .first(),
          ).toBeVisible();
          stage += " document language";
          await expect(page.locator("html")).toHaveAttribute("lang", locale);
          if (
            await page
              .getByText(
                /Something went wrong|Sprint [12346] migrations are required/,
              )
              .count()
          )
            throw new Error("Page integration error.");
          await page.evaluate(() => document.fonts.ready);
          stage += " layout";
          expect(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
          ).toBe(true);
          if (route === "trips" && role === "ADMIN") {
            const w = await sessions
              .get("ADMIN")
              .client.rpc("operations_workspace", { p_trip: null });
            const date = w.data.trips[0]?.date_label;
            if (date) {
              const bs = adToBs(date);
              await expect(page.locator("#main-content")).toContainText(
                locale === "en"
                  ? String(bs.year)
                  : String(bs.year).replace(
                      /\d/g,
                      (d) => "०१२३४५६७८९"[Number(d)],
                    ),
              );
            }
          }
          if (route === "inventory") {
            const range = await page
              .getByRole("button", { name: label("To date"), exact: true })
              .first();
            await range.click();
            await expect(
              page.getByRole("dialog", { name: label("BS calendar") }),
            ).toBeVisible();
            expect(
              await page.evaluate(
                () => document.documentElement.scrollWidth <= innerWidth,
              ),
            ).toBe(true);
            await page.keyboard.press("Escape");
          }
        }
        if (role === "ADMIN") {
          stage = "Cloud monthly credit exports";
          const workspace = await sessions
            .get("ADMIN")
            .client.rpc("operations_workspace", { p_trip: null });
          const customer = workspace.data.customers[0];
          if (customer) {
            const parts = new Intl.DateTimeFormat("en", {
              timeZone: "Asia/Kathmandu",
              year: "numeric",
              month: "2-digit",
              day: "2-digit",
            }).formatToParts(new Date());
            const part = (name) => parts.find((p) => p.type === name).value;
            const bs = adToBs(
              `${part("year")}-${part("month")}-${part("day")}`,
            );
            const query = new URLSearchParams({
              from: bsToAdIso({ ...bs, day: 1 }),
              to: bsToAdIso({ ...bs, day: daysInBsMonth(bs.year, bs.month) }),
            });
            const csv = await page.request.get(
              `${base}/api/customer-statements/${customer.id}?${query}&format=csv`,
            );
            expect(csv.status()).toBe(200);
            expect(await csv.text()).toContain("CanonicalTimestamp");
            const pdf = await page.request.get(
              `${base}/api/customer-statements/${customer.id}?${query}&format=pdf`,
            );
            expect(pdf.status()).toBe(200);
            expect(pdf.headers()["content-type"]).toBe("application/pdf");
            expect((await pdf.body()).length).toBeGreaterThan(1000);
          }
        }
        if (role === "DRIVER") {
          stage = "driver authorization";
          await page.goto(`${base}/admin/inventory`);
          await expect(page).toHaveURL(/driver\/home/);
        }
        await page
          .getByRole("button", { name: label("Sign out"), exact: true })
          .click();
        await expect(page).toHaveURL(/sign-in/);
        if (savePreference) {
          stage = `${role} stored preference after login`;
          await page
            .getByRole("button", { name: "English", exact: true })
            .click();
          await page
            .getByLabel("Email address")
            .fill(`${role.toLowerCase()}@mount-kailash.example`);
          await page
            .getByLabel("Password", { exact: true })
            .fill(process.env[`DEMO_${role}_PASSWORD`]);
          await page
            .getByRole("button", { name: "Sign in", exact: true })
            .click();
          await expect(page).toHaveURL(
            role === "ADMIN" ? /admin\/dashboard/ : /driver\/home/,
          );
          await expect(
            page.getByRole("button", {
              name: locale === "en" ? "English" : "नेपाली",
              exact: true,
            }),
          ).toHaveAttribute("aria-pressed", "true");
          await page
            .getByRole("button", { name: label("Sign out"), exact: true })
            .click();
          await expect(page).toHaveURL(/sign-in/);
        }
        console.log(
          `${role} ${viewport.width}px: sign-in, localized pages, BS display, layout and sign-out passed (${locale}).`,
        );
      } finally {
        await context.close();
      }
    }
  const after = await snapshot(sessions.get("ADMIN").client);
  if (before.hash !== after.hash)
    throw new Error("Business data changed during verification.");
  console.log(
    savePreference
      ? "Cloud workspace snapshots are unchanged; only each demo account's current display locale was saved and verified after login."
      : "Cloud workspace snapshots are unchanged; no business or preference writes performed.",
  );
} catch {
  console.error(
    `Cloud localization check failed at: ${stage}. No private diagnostics printed.`,
  );
  process.exitCode = 1;
} finally {
  await browser?.close();
  for (const c of clients) await c.auth.signOut({ scope: "local" });
}
