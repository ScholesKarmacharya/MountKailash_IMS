import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import {
  activeFixtureTrip,
  fixtureIds,
} from "../operations-e2e/fixture-client";
import type { FinanceWorkspace } from "../../src/domain/finance/types";
import ne from "../../src/lib/i18n/ne.json";

const pin = "582947";
async function en(page: Page) {
  await page.getByRole("button", { name: "English", exact: true }).click();
}
async function login(page: Page, role = "driver") {
  await page.goto("/sign-in?reauth=1");
  await en(page);
  await page.getByLabel("Email address").fill(`${role}@fixture.example`);
  await page.getByLabel("Password", { exact: true }).fill("fixture-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(
    role === "driver"
      ? "**/driver/home"
      : role === "pending"
        ? "**/account"
        : role === "admin"
          ? "**/admin/dashboard"
          : "**/driver/home",
  );
  await en(page);
}
async function activate(page: Page) {
  await login(page);
  await expect(page.getByTestId("driver-remaining-full-jars")).toHaveText(
    "100",
  );
  await page
    .getByRole("button", { name: "Set up offline access", exact: true })
    .click();
  await page.getByLabel("Enter PIN", { exact: true }).fill(pin);
  await page.getByLabel("Confirm PIN", { exact: true }).fill(pin);
  await page.getByRole("button", { name: "नेपाली", exact: true }).click();
  await expect(page.getByLabel(ne["Enter PIN"], { exact: true })).toHaveValue(
    pin,
  );
  await en(page);
  await expect(page.getByLabel("Confirm PIN", { exact: true })).toHaveValue(
    pin,
  );
  await page
    .locator("#device-unlock")
    .getByRole("button", { name: "Prepare this device online", exact: true })
    .click();
  await expect(page.getByText("All Synced", { exact: true })).toBeVisible({
    timeout: 30000,
  });
  await expect(
    page.getByRole("button", { name: "Lock App", exact: true }),
  ).toBeVisible();
}
async function unlock(page: Page, value = pin) {
  await en(page);
  await page
    .locator("#device-unlock")
    .getByLabel("Enter PIN", { exact: true })
    .fill(value);
  await page
    .locator("#device-unlock")
    .getByRole("button", { name: "Unlock App", exact: true })
    .click();
}
async function nav(page: Page, label: string) {
  await page
    .getByRole("navigation")
    .getByRole("link", { name: label, exact: true })
    .click();
}
async function deliver(
  page: Page,
  customer: string,
  quantity = 35,
  expectSaved = true,
) {
  await nav(page, "New Sale");
  await page.locator(`[data-customer-id="${customer}"]`).click();
  await page
    .getByLabel("Jars Delivered", { exact: true })
    .fill(String(quantity));
  await page.getByLabel("Empty Jars Returned", { exact: true }).fill("0");
  await page.getByRole("button", { name: "Credit", exact: true }).click();
  await page
    .getByRole("button", { name: "Review delivery", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Save Delivery", exact: true })
    .click();
  if (expectSaved)
    await expect(
      page.getByText("Saved on Device", { exact: true }).first(),
    ).toBeVisible();
}
async function localRows(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open("mount-kailash-offline");
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const read = (name: string) =>
      new Promise<Record<string, unknown>[]>((resolve, reject) => {
        const r = db.transaction(name).objectStore(name).getAll();
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
    const [vaults, settings] = await Promise.all([
      read("vaults"),
      read("settings"),
    ]);
    db.close();
    return { vaults, settings };
  });
}
test("one-time activation reopens offline with a PIN, records 35/100 jars and syncs once after a lost response", async ({
  page,
  context,
  request,
  browser,
}) => {
  test.setTimeout(180000);
  page.on("dialog", (d) => d.accept());
  const f = await activeFixtureTrip(request);
  await page.goto("/sign-in");
  await page.evaluate(async () => {
    const old = await caches.open("mount-kailash-shell-v1");
    await old.put(
      "/offline",
      new Response("<html><body>Old shell without PIN support</body></html>", {
        headers: { "Content-Type": "text/html" },
      }),
    );
  });
  await activate(page);
  const directory = await f.admin.rpc<{ device_id: string; name: string }[]>(
    "trusted_device_directory",
    {},
  );
  expect(directory).toHaveLength(1);
  await context.setOffline(true);
  const reopened = await context.newPage();
  await page.close();
  reopened.on("dialog", (d) => d.accept());
  await reopened.goto("/driver/home");
  await en(reopened);
  await expect(reopened.getByLabel("Email address")).toHaveCount(0);
  await expect(reopened.getByTestId("driver-remaining-full-jars")).toHaveCount(
    0,
  );
  await unlock(reopened);
  await expect(reopened.getByTestId("driver-total-jars-loaded")).toHaveText(
    "100",
  );
  await expect(reopened.getByTestId("driver-full-jars-sold")).toHaveText("0");
  await deliver(reopened, f.customer);
  await expect(
    reopened.getByText("Saved on Device", { exact: true }).first(),
  ).toBeVisible();
  await nav(reopened, "My Stock");
  await expect(reopened.getByTestId("driver-remaining-full-jars")).toHaveText(
    "65",
  );
  await expect(reopened.getByTestId("driver-full-jars-sold")).toHaveText("35");
  const stored = await localRows(reopened);
  expect(stored.vaults[0]?.pending).toBe(1);
  expect(JSON.stringify(stored.settings)).not.toContain(pin);
  await reopened.reload();
  await unlock(reopened);
  await expect(reopened.getByTestId("driver-remaining-full-jars")).toHaveText(
    "65",
  );
  let lost = false,
    committed = false;
  await reopened.route("**/api/driver/offline", async (route) => {
    const body = route.request().postDataJSON();
    if (!lost && body?.action === "post") {
      lost = true;
      await route.fetch();
      await context.setOffline(true);
      await route.abort("internetdisconnected");
      committed = true;
    } else await route.continue();
  });
  await context.setOffline(false);
  await expect.poll(() => committed, { timeout: 30000 }).toBe(true);
  expect((await f.admin.workspace(f.trip)).visits).toHaveLength(1);
  await expect(reopened.getByTestId("pending-sync-count")).toHaveText(
    "Pending records: 1",
  );
  await reopened.reload();
  await unlock(reopened);
  await reopened.unroute("**/api/driver/offline");
  await context.setOffline(false);
  await expect(reopened.getByText("All Synced", { exact: true })).toBeVisible({
    timeout: 45000,
  });
  await expect(reopened.getByTestId("pending-sync-count")).toHaveText(
    "Pending records: 0",
  );
  expect((await f.admin.workspace(f.trip)).visits).toHaveLength(1);
  const finance = await f.admin.rpc<FinanceWorkspace>("finance_workspace", {});
  expect(finance.invoices).toHaveLength(1);
  expect(finance.credit[0]?.outstanding).toBe("5258.75");
  const adminContext = await browser.newContext({
    baseURL: new URL(reopened.url()).origin,
  });
  try {
    const admin = await adminContext.newPage();
    await login(admin, "admin");
    await admin.goto(`/admin/trips/${f.trip}`);
    await expect(admin.getByTestId("driver-full-jars-sold")).toHaveText("35");
    await expect(admin.getByTestId("driver-remaining-full-jars")).toHaveText(
      "65",
    );
    await admin.goto("/admin/sync");
    await expect(
      admin.getByText(/^Last confirmed synchronization:/),
    ).toBeVisible();
    await expect(
      admin.getByText(directory[0]!.device_id, { exact: true }),
    ).toBeVisible();
  } finally {
    await adminContext.close();
  }
  await reopened.goto("/");
  await expect(reopened).toHaveURL(/\/driver\/home$/);
  await expect(reopened.getByLabel("Email address")).toHaveCount(0);
  await unlock(reopened);
  await expect(reopened.getByTestId("driver-remaining-full-jars")).toHaveText(
    "65",
  );
});
test("Lock App preserves trust; wrong PIN throttles; password recovery and Sign Out preserve pending sales", async ({
  page,
  context,
  request,
}) => {
  test.setTimeout(180000);
  page.on("dialog", (d) => d.accept());
  const f = await activeFixtureTrip(request);
  await activate(page);
  await context.setOffline(true);
  await deliver(page, f.customer, 5);
  await nav(page, "My Stock");
  await page.getByRole("button", { name: "Lock App", exact: true }).click();
  await expect(page.getByTestId("driver-remaining-full-jars")).toHaveCount(0);
  for (let i = 0; i < 5; i++) {
    await unlock(page, "582946");
    await expect(
      page.getByRole("alert").filter({ hasText: "Incorrect PIN" }),
    ).toBeVisible();
  }
  await page.reload();
  await unlock(page);
  await expect(
    page.getByRole("alert").filter({ hasText: "Too many unlock attempts" }),
  ).toBeVisible();
  expect((await localRows(page)).vaults[0]?.pending).toBe(1);
  await context.setOffline(false);
  await expect(
    page.getByTestId("driver-sync-status").getByText("Online", { exact: true }),
  ).toBeVisible();
  await page.getByText("Device access", { exact: true }).first().click();
  await page
    .getByRole("button", { name: "Recover PIN online", exact: true })
    .click();
  const card = page
    .locator("section,div")
    .filter({
      has: page.getByRole("heading", {
        name: "Recover PIN online",
        exact: true,
      }),
    })
    .last();
  await card.getByLabel("Password", { exact: true }).fill("wrong-password");
  await card.getByLabel("New PIN", { exact: true }).fill("748295");
  await card.getByLabel("Confirm PIN", { exact: true }).fill("748295");
  await card.getByRole("button", { name: "Reset PIN", exact: true }).click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Online reauthentication failed" }),
  ).toBeVisible();
  expect((await localRows(page)).vaults[0]?.pending).toBe(1);
  await card.getByLabel("Password", { exact: true }).fill("fixture-password");
  await card.getByRole("button", { name: "Reset PIN", exact: true }).click();
  await expect(
    page.getByText("PIN updated. Your saved records are preserved.", {
      exact: true,
    }),
  ).toBeVisible();
  await unlock(page, "748295");
  await expect(page.getByText("All Synced", { exact: true })).toBeVisible({
    timeout: 45000,
  });
  expect((await f.admin.workspace(f.trip)).visits).toHaveLength(1);
  await context.setOffline(true);
  await deliver(page, f.customer, 3);
  await nav(page, "My Stock");
  await context.setOffline(false);
  // Hold sync while logging out so the preservation assertion covers pending data.
  await page.route("**/api/driver/offline", (route) => route.abort());
  await page.getByRole("button", { name: "Sign Out", exact: true }).click();
  await page.waitForURL("**/sign-in");
  expect((await localRows(page)).vaults[0]?.pending).toBe(1);
  await context.setOffline(true);
  await page.goto("/driver/home");
  await en(page);
  await expect(page.getByTestId("driver-remaining-full-jars")).toHaveCount(0);
  await context.setOffline(false);
  await page.unroute("**/api/driver/offline");
  await login(page, "other");
  await expect(page.getByTestId("driver-remaining-full-jars")).toHaveCount(0);
  await expect(page.getByLabel("Enter PIN", { exact: true })).toHaveCount(0);
  expect((await localRows(page)).vaults[0]?.pending).toBe(1);
  await page.getByRole("button", { name: "Sign Out", exact: true }).click();
  await page.waitForURL("**/sign-in");
  await login(page);
  await unlock(page, "748295");
  await expect(page.getByText("All Synced", { exact: true })).toBeVisible({
    timeout: 45000,
  });
  expect((await f.admin.workspace(f.trip)).visits).toHaveLength(2);
});
test("admin revocation blocks automatic upload and retains encrypted offline evidence", async ({
  page,
  context,
  request,
}) => {
  page.on("dialog", (d) => d.accept());
  const f = await activeFixtureTrip(request);
  await activate(page);
  await context.setOffline(true);
  await deliver(page, f.customer, 5);
  const [device] = await f.admin.rpc<{ device_id: string }[]>(
    "trusted_device_directory",
    {},
  );
  await f.admin.rpc("trusted_device_revoke", {
    p_device: device!.device_id,
    p_reason: "Isolated lost-phone test",
  });
  await context.setOffline(false);
  await expect(
    page.getByText("Needs Review", { exact: false }).first(),
  ).toBeVisible({ timeout: 30000 });
  expect((await localRows(page)).vaults[0]?.pending).toBe(1);
  expect((await f.admin.workspace(f.trip)).visits).toHaveLength(0);
});
test("an unregistered or pending driver cannot activate offline access", async ({
  page,
  request,
  browser,
}) => {
  await activeFixtureTrip(request);
  await page.goto("/driver/home");
  await en(page);
  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(page.getByLabel("Email address", { exact: true })).toBeVisible();
  await expect(page.getByTestId("driver-remaining-full-jars")).toHaveCount(0);
  const origin = new URL(page.url()).origin;
  const denied = await page.request.post("/api/driver/device", {
    headers: { Origin: origin },
    data: { action: "register", device: randomUUID(), secrets: {} },
  });
  expect(denied.status()).toBe(401);
  const pendingContext = await browser.newContext({ baseURL: origin });
  try {
    const p = await pendingContext.newPage();
    p.on("dialog", (d) => d.accept());
    await login(p, "pending");
    await p
      .getByLabel("Full name", { exact: true })
      .fill("Pending fixture driver");
    await p.getByLabel("Phone (optional)", { exact: true }).fill("9801234567");
    await p.getByRole("button", { name: "Save profile", exact: true }).click();
    await expect(
      p.getByText("Waiting for Admin Approval", { exact: true }).first(),
    ).toBeVisible();
    await expect(
      p.getByText("Pending fixture driver", { exact: true }).first(),
    ).toBeVisible();
    const denied = await p.request.post("/api/driver/device", {
      headers: { Origin: origin },
      data: { action: "register", device: randomUUID(), secrets: {} },
    });
    expect(denied.status()).toBe(403);
  } finally {
    await pendingContext.close();
  }
});
test("an expired grant preserves prior sales but cannot authorize additional offline stock changes", async ({
  page,
  context,
  request,
}) => {
  page.on("dialog", (d) => d.accept());
  const f = await activeFixtureTrip(request);
  await activate(page);
  await context.setOffline(true);
  await deliver(page, f.customer, 5);
  await nav(page, "My Stock");
  await page.clock.setFixedTime(new Date(Date.now() + 25 * 3600000));
  await deliver(page, f.customer, 2, false);
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Reconnect to renew driver authorization" })
      .first(),
  ).toBeVisible();
  expect((await localRows(page)).vaults[0]?.pending).toBe(1);
  await nav(page, "My Stock");
  await expect(page.getByTestId("driver-remaining-full-jars")).toHaveText("95");
});
test("a suspended driver cannot upload a pending sale or renew its offline grant", async ({
  page,
  context,
  request,
}) => {
  page.on("dialog", (d) => d.accept());
  const f = await activeFixtureTrip(request);
  await activate(page);
  await context.setOffline(true);
  await deliver(page, f.customer, 5);
  const directory = await f.admin.rpc<{ id: string; version: number }[]>(
    "admin_driver_directory",
    {},
  );
  const driver = directory.find((d) => d.id === fixtureIds.driver)!;
  await f.admin.rpc("change_driver_status", {
    p_id: driver.id,
    p_status: "SUSPENDED",
    p_version: driver.version,
    p_reason: "Isolated suspension test",
    p_key: randomUUID(),
  });
  await context.setOffline(false);
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Driver authorization is unavailable" })
      .first(),
  ).toBeVisible({ timeout: 30000 });
  expect((await localRows(page)).vaults[0]?.pending).toBe(1);
  expect((await f.admin.workspace(f.trip)).visits).toHaveLength(0);
});
test("removing a synced sealed device revokes access but keeps encrypted journals", async ({
  page,
  request,
}) => {
  page.on("dialog", (d) => d.accept());
  const f = await activeFixtureTrip(request);
  await activate(page);
  await page.getByText("Device access", { exact: true }).first().click();
  await expect(
    page.getByRole("button", { name: "Remove Device", exact: true }),
  ).toBeDisabled();
  await nav(page, "Return to Warehouse");
  await page
    .getByRole("button", {
      name: "Prepare return and seal device queue",
      exact: true,
    })
    .click();
  await expect(page.getByText("All Synced", { exact: true })).toBeVisible({
    timeout: 30000,
  });
  await expect(
    page.getByRole("button", { name: "Remove Device", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Remove Device", exact: true })
    .click();
  await expect(
    page.getByText("Device access removed. Encrypted records are preserved.", {
      exact: true,
    }),
  ).toBeVisible();
  expect((await localRows(page)).vaults).toHaveLength(1);
  const devices = await f.admin.rpc<{ revoked_at: string | null }[]>(
    "trusted_device_directory",
    {},
  );
  expect(devices[0]?.revoked_at).toBeTruthy();
});
test("offline Sign Out clears online credentials while protecting pending records", async ({
  page,
  context,
  request,
}) => {
  page.on("dialog", (d) => d.accept());
  const f = await activeFixtureTrip(request);
  await activate(page);
  await context.setOffline(true);
  await deliver(page, f.customer, 5);
  await nav(page, "My Stock");
  await page.getByRole("button", { name: "Sign Out", exact: true }).click();
  await page.waitForURL("**/sign-in?reauth=1");
  await en(page);
  expect(
    (await context.cookies()).filter((c) => /^sb-.*-auth-token/.test(c.name)),
  ).toHaveLength(0);
  expect((await localRows(page)).vaults[0]?.pending).toBe(1);
  await context.setOffline(false);
  await login(page);
  await unlock(page);
  await expect(page.getByText("All Synced", { exact: true })).toBeVisible({
    timeout: 45000,
  });
  expect((await f.admin.workspace(f.trip)).visits).toHaveLength(1);
});
test("an existing passphrase vault can adopt a PIN without replacing its pending delivery", async ({
  page,
  context,
  request,
}) => {
  page.on("dialog", (d) => d.accept());
  const f = await activeFixtureTrip(request);
  await login(page);
  await page
    .getByRole("button", { name: "Set up offline access", exact: true })
    .click();
  await page
    .getByLabel("Offline passphrase", { exact: true })
    .fill("legacy-driver-strong-passphrase");
  await page
    .getByRole("button", { name: "Prepare this device online", exact: true })
    .click();
  await expect(page.getByText("All Synced", { exact: true })).toBeVisible({
    timeout: 30000,
  });
  await context.setOffline(true);
  await deliver(page, f.customer, 5);
  // Keep the outbox pending while online trust registration is confirmed.
  await page.route("**/api/driver/offline", (r) => r.abort());
  await context.setOffline(false);
  await page
    .getByRole("button", { name: "Set unlock PIN", exact: true })
    .click();
  await page.getByLabel("Enter PIN", { exact: true }).fill(pin);
  await page.getByLabel("Confirm PIN", { exact: true }).fill(pin);
  await page.getByRole("button", { name: "Save PIN", exact: true }).click();
  await expect(page.getByText("Device Ready", { exact: true })).toBeVisible();
  await context.setOffline(true);
  await page.reload();
  await unlock(page);
  await expect(page.getByTestId("pending-sync-count")).toHaveText(
    "Pending records: 1",
  );
  await page.unroute("**/api/driver/offline");
  await context.setOffline(false);
  await expect(page.getByText("All Synced", { exact: true })).toBeVisible({
    timeout: 45000,
  });
  expect((await f.admin.workspace(f.trip)).visits).toHaveLength(1);
});
test("the same trusted phone automatically prepares a later confirmed active round", async ({
  page,
  context,
  request,
}) => {
  page.on("dialog", (d) => d.accept());
  const f = await activeFixtureTrip(request);
  await activate(page);
  await nav(page, "Return to Warehouse");
  await page
    .getByRole("button", {
      name: "Prepare return and seal device queue",
      exact: true,
    })
    .click();
  await expect
    .poll(async () => (await f.admin.workspace(f.trip)).trips[0]?.status)
    .toBe("SUBMITTED");
  await expect(page.getByText("All Synced", { exact: true })).toBeVisible({
    timeout: 30000,
  });
  await f.admin.rpc("reconcile_trip", {
    p_trip: f.trip,
    p_counts: [
      { product_id: fixtureIds.jar, stock_kind: "FULL_JAR", quantity: 100 },
      { product_id: fixtureIds.jar, stock_kind: "EMPTY_JAR", quantity: 0 },
    ],
    p_reason: "Isolated verified reload",
    p_accept_variance: false,
    p_key: randomUUID(),
  });
  const original = (await f.admin.workspace(f.trip)).trips[0]!,
    trip = randomUUID();
  await f.admin.rpc("create_trip", {
    p_id: trip,
    p_driver: fixtureIds.driver,
    p_vehicle: original.vehicle_id,
    p_day: original.business_day_id,
    p_customers: [],
    p_notes: "Isolated later round",
    p_key: randomUUID(),
  });
  await f.admin.rpc("load_trip", {
    p_trip: trip,
    p_items: [
      { product_id: fixtureIds.jar, stock_kind: "FULL_JAR", quantity: 40 },
    ],
    p_key: randomUUID(),
  });
  await nav(page, "My Stock");
  await expect(
    page.getByRole("button", { name: "Start delivering", exact: true }),
  ).toBeVisible({ timeout: 20000 });
  await page
    .getByRole("button", { name: "Start delivering", exact: true })
    .click();
  await expect(
    page.getByText("Device records unlocked", { exact: true }),
  ).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId("driver-total-jars-loaded")).toHaveText("40");
  await expect.poll(async () => (await localRows(page)).vaults.length).toBe(2);
  expect(
    await f.admin.rpc<unknown[]>("trusted_device_directory", {}),
  ).toHaveLength(1);
  await context.setOffline(true);
  await page.reload();
  await unlock(page);
  await expect(page.getByTestId("driver-remaining-full-jars")).toHaveText("40");
  await deliver(page, f.customer, 5);
  await nav(page, "My Stock");
  await expect(page.getByTestId("driver-remaining-full-jars")).toHaveText("35");
  await context.setOffline(false);
  await expect(page.getByText("All Synced", { exact: true })).toBeVisible({
    timeout: 45000,
  });
  expect((await f.admin.workspace(trip)).visits).toHaveLength(1);
});
test("an expired online session cannot upload but a valid local grant still permits an offline reopen", async ({
  page,
  context,
  request,
}) => {
  page.on("dialog", (d) => d.accept());
  const f = await activeFixtureTrip(request);
  await activate(page);
  const auth = (await context.cookies()).find((c) =>
    c.name.includes("auth-token"),
  )!;
  const session = JSON.parse(
    Buffer.from(auth.value.replace(/^base64-/, ""), "base64url").toString(),
  );
  const parts = session.access_token.split(".");
  parts[1] = Buffer.from(
    JSON.stringify({
      ...JSON.parse(Buffer.from(parts[1], "base64url").toString()),
      exp: 1,
    }),
  ).toString("base64url");
  session.access_token = parts.join(".");
  session.expires_at = 1;
  session.refresh_token = "invalid-fixture-refresh";
  await context.setOffline(true);
  await context.addCookies([
    {
      ...auth,
      value: `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`,
    },
  ]);
  await page.reload();
  await unlock(page);
  await deliver(page, f.customer, 5);
  await nav(page, "My Stock");
  await context.setOffline(false);
  await expect(
    page.getByRole("alert").filter({ hasText: "Sign in online again" }).first(),
  ).toBeVisible({ timeout: 30000 });
  expect((await localRows(page)).vaults[0]?.pending).toBe(1);
  expect((await f.admin.workspace(f.trip)).visits).toHaveLength(0);
  await login(page);
  await unlock(page);
  await expect(page.getByText("All Synced", { exact: true })).toBeVisible({
    timeout: 45000,
  });
  expect((await f.admin.workspace(f.trip)).visits).toHaveLength(1);
});
