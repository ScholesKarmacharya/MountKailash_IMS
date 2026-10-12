import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { chromium, expect } from "@playwright/test";
// Read-only business/profile checks using existing accounts. No fixtures, profile
// edits, status changes, metadata writes, screenshots, traces or session files.
const ref = readFileSync("supabase/.temp/project-ref", "utf8").trim();
const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
  key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (url !== `https://${ref}.supabase.co` || !key)
  throw new Error("Use the linked Cloud environment.");
const base =
  process.argv.find((a) => /^http:\/\//.test(a)) ?? "http://localhost:3000";
if (!["localhost", "127.0.0.1"].includes(new URL(base).hostname))
  throw new Error("Use a loopback development server.");
const inspect = process.argv.includes("--inspect"),
  clients = [],
  sessions = new Map();
const en = JSON.parse(readFileSync("src/lib/i18n/en.json", "utf8")),
  ne = JSON.parse(readFileSync("src/lib/i18n/ne.json", "utf8"));
let browser,
  stage = "existing account authentication";
async function snapshot(client) {
  const results = await Promise.all([
    client.rpc("operations_workspace", { p_trip: null }),
    client.rpc("finance_workspace"),
  ]);
  if (results.some((r) => r.error))
    throw new Error("Existing workspaces could not be read.");
  return createHash("sha256")
    .update(JSON.stringify(results.map((r) => r.data)))
    .digest("hex");
}
try {
  for (const role of ["ADMIN", "DRIVER"]) {
    const password = process.env[`DEMO_${role}_PASSWORD`];
    if (!password) throw new Error("Existing demo credentials are missing.");
    const client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    clients.push(client);
    const auth = await client.auth.signInWithPassword({
      email: `${role.toLowerCase()}@mount-kailash.example`,
      password,
    });
    if (auth.error || !auth.data.user)
      throw new Error("Existing account authentication failed.");
    const result = await client
      .from("profiles")
      .select("*")
      .eq("id", auth.data.user.id)
      .single();
    if (result.error || result.data.role !== role || !result.data.is_active)
      throw new Error("Existing authorization failed.");
    const locale = ["en", "ne"].includes(auth.data.user.user_metadata.locale)
      ? auth.data.user.user_metadata.locale
      : role === "DRIVER"
        ? "ne"
        : "en";
    sessions.set(role, { client, profile: result.data, locale, password });
  }
  const admin = sessions.get("ADMIN").client,
    before = await snapshot(admin);
  const profiles = await admin
    .from("profiles")
    .select("*")
    .eq("role", "DRIVER");
  if (profiles.error) throw new Error("Existing driver inspection failed.");
  console.log(
    "Existing trusted driver profiles (no credentials):",
    profiles.data.map((p) => ({
      id: p.id,
      name: p.name,
      active: p.is_active,
      status: p.approval_status ?? "LEGACY",
    })),
  );
  const driver = sessions.get("DRIVER");
  console.log(
    "Existing demo driver identity and active database profile match:",
    profiles.data.some((p) => p.id === driver.profile.id && p.is_active),
  );
  const directory = await admin.rpc("admin_driver_directory");
  if (directory.error && !["PGRST202", "42883"].includes(directory.error.code))
    throw new Error("Approval directory check failed.");
  console.log("Cloud approval migration applied:", !directory.error);
  if (!directory.error) {
    stage = "approval backfill and read authorization";
    expect(driver.profile.approval_status).toBe("APPROVED");
    const listed = directory.data.find((p) => p.id === driver.profile.id);
    expect(listed).toBeDefined();
    expect(listed.approval_status).toBe("APPROVED");
    expect(listed.is_active).toBe(true);
    expect(listed.name).toBe(driver.profile.name);
    expect(listed.email).toBe("driver@mount-kailash.example");
    const forbidden = await driver.client.rpc("admin_driver_directory");
    expect(forbidden.error?.code).toBe("42501");
    const access = await driver.client.rpc("has_operational_access");
    expect(access.error).toBeNull();
    expect(access.data).toBe(true);
    const anonymous = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const denied = await anonymous.rpc("admin_driver_directory");
    expect(denied.error?.code).toBe("42501");
    console.log(
      "Approved driver access retained; driver and anonymous admin-directory reads denied.",
    );
  }
  const settings = await fetch(`${url}/auth/v1/settings`, {
    headers: { apikey: key },
  });
  if (!settings.ok) throw new Error("Auth settings check failed.");
  console.log(
    "Cloud public signup disabled:",
    (await settings.json()).disable_signup === true,
  );
  if (!inspect) {
    browser = await chromium.launch({ channel: "chromium" });
    for (const viewport of [
      { width: 1280, height: 900 },
      { width: 393, height: 851 },
    ])
      for (const role of ["ADMIN", "DRIVER"]) {
        const { profile, locale, password } = sessions.get(role),
          dictionary = locale === "ne" ? ne : en,
          label = (k) => dictionary[k] ?? k;
        const context = await browser.newContext({ viewport });
        try {
          const page = await context.newPage();
          page.setDefaultTimeout(30000);
          stage = `${role} ${viewport.width}px browser sign-in`;
          await page.goto(`${base}/sign-in`);
          await page
            .getByLabel(/Email address|इमेल ठेगाना/)
            .fill(`${role.toLowerCase()}@mount-kailash.example`);
          await page
            .getByLabel(/Password|पासवर्ड/, { exact: true })
            .fill(password);
          await page
            .getByRole("button", { name: /^(Sign in|लग इन गर्नुहोस्)$/ })
            .click();
          const home = role === "ADMIN" ? "/admin/dashboard" : "/driver/home";
          await page.waitForURL((u) => u.pathname === home);
          stage = `${role} ${viewport.width}px database name and navigation`;
          await expect(page.getByTestId("profile-name")).toHaveText(
            profile.name,
          );
          await page.reload();
          await expect(page.getByTestId("profile-name")).toHaveText(
            profile.name,
          );
          if (role === "DRIVER")
            for (const key of [
              "My Stock",
              "New Sale",
              "Customers",
              "Unreturned Jars",
              "Sales History",
              "Return to Warehouse",
            ])
              await expect(
                page
                  .getByRole("navigation")
                  .getByRole("link", { name: label(key), exact: true }),
              ).toBeVisible();
          expect(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
          ).toBe(true);
          if (!directory.error) {
            stage = `${role} ${viewport.width}px read-only profile page`;
            await page.goto(`${base}/account/profile`);
            await expect(
              page.getByLabel(label("Full name"), { exact: true }),
            ).toHaveValue(profile.name);
            await expect(
              page.getByRole("button", {
                name: label("Save profile"),
                exact: true,
              }),
            ).toBeVisible();
            if (role === "ADMIN") {
              stage = `${role} ${viewport.width}px driver directory and details`;
              await page.goto(`${base}/admin/drivers`);
              await expect(
                page.getByRole("heading", {
                  name: driver.profile.name,
                  exact: true,
                }),
              ).toBeVisible();
              await expect(
                page.getByText("driver@mount-kailash.example", { exact: true }),
              ).toBeVisible();
              await page
                .getByRole("link", {
                  name: label("View Driver Details"),
                  exact: true,
                })
                .click();
              await expect(page).toHaveURL(
                new RegExp(`/admin/drivers/${driver.profile.id}$`),
              );
              await expect(
                page.getByRole("status").filter({ hasText: label("Approved") }),
              ).toBeVisible();
              await expect(
                page.getByRole("button", {
                  name: label("Suspend Driver"),
                  exact: true,
                }),
              ).toBeVisible();
            } else {
              stage = `${role} ${viewport.width}px protected admin exclusion`;
              await page.goto(`${base}/admin/drivers`);
              await page.waitForURL((u) => u.pathname === home);
            }
            expect(
              await page.evaluate(
                () => document.documentElement.scrollWidth <= innerWidth,
              ),
            ).toBe(true);
            console.log(
              `${role} ${viewport.width}px: profile page and authorized driver-directory scope passed without saves.`,
            );
          }
          stage = `${role} ${viewport.width}px sign-out`;
          await page
            .getByRole("button", { name: label("Sign Out"), exact: true })
            .click();
          await page.waitForURL((u) => u.pathname === "/sign-in");
          await page.goto(`${base}${home}`);
          await page.waitForURL((u) => u.pathname === "/sign-in");
          console.log(
            `${role} ${viewport.width}px: actual profile name, refresh, navigation, layout, sign-out and protected-route exclusion passed.`,
          );
        } finally {
          await context.close();
        }
      }
  }
  stage = "business history preservation";
  if (before !== (await snapshot(admin)))
    throw new Error("Business snapshot changed; inspect concurrent activity.");
  console.log(
    "Existing business snapshots unchanged. No account/profile/status or business writes performed.",
  );
} catch {
  console.error(
    `Read-only Cloud verification failed at: ${stage}. Provider details and credentials withheld.`,
  );
  process.exitCode = 1;
} finally {
  await browser?.close();
  for (const client of clients) await client.auth.signOut({ scope: "local" });
}
