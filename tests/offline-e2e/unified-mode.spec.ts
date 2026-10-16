import { test, expect, type Page } from "@playwright/test";
import { activeFixtureTrip } from "../operations-e2e/fixture-client";
import type { FinanceWorkspace } from "../../src/domain/finance/types";
import { randomUUID } from "node:crypto";
async function login(page: Page, role = "driver") {
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "English", exact: true }).click();
  await page.getByLabel("Email address").fill(`${role}@fixture.example`);
  await page.getByLabel("Password", { exact: true }).fill("fixture-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(
    role === "driver" ? "**/driver/home" : "**/admin/dashboard",
  );
  await page.getByRole("button", { name: "English", exact: true }).click();
}
async function prepare(page: Page) {
  await expect(page.getByText("Offline ready", { exact: true })).toBeVisible({
    timeout: 30000,
  });

  await expect(page.getByText("All synced", { exact: true })).toBeVisible({
    timeout: 30000,
  });
}
const formFor = (page: Page) =>
  page.locator("form").filter({
    has: page.locator('input[name="operation"][value="driver-visit"]'),
  });

test("a second browser keeps the online form but cannot replace the registered writer or its pending records", async ({
  page,
  context,
  request,
  browser,
}) => {
  page.on("dialog", (d) => d.accept());
  const f = await activeFixtureTrip(request);
  await login(page);
  await prepare(page);
  await nav(page, "New Sale");
  await context.setOffline(true);
  await expect(
    page
      .getByTestId("driver-sync-status")
      .getByText("Offline", { exact: true }),
  ).toBeVisible();
  await sale(page, 3, false);
  await expect(
    formFor(page).getByText("Saved on phone", { exact: true }),
  ).toBeVisible();
  const secondContext = await browser.newContext({
    baseURL: new URL(page.url()).origin,
    viewport: page.viewportSize()!,
  });
  try {
    const second = await secondContext.newPage();
    second.on("dialog", (d) => d.accept());
    await login(second);
    await nav(second, "New Sale");
    await expect(second).toHaveURL(/\/driver\/delivery$/);
    await expect(second.getByLabel("Offline passphrase")).toHaveCount(0);
    await sale(second, 2, true, false);
    await expect(
      second.getByRole("button", { name: "Save Delivery", exact: true }),
    ).toBeDisabled();
    await expect(
      second
        .getByRole("alert")
        .filter({
          hasText:
            "This trip is linked to another phone. Ask the warehouse admin to reset offline access.",
        })
        .first(),
    ).toBeVisible();
    await expect(
      formFor(second)
        .getByRole("region", { name: "20L test jar" })
        .getByRole("definition")
        .first(),
    ).toHaveText("2");
    // The authenticated API independently enforces the same rule even if a
    // competing client bypasses the disabled control.
    const denied = await second.request.post("/api/driver/offline", {
      headers: { Origin: new URL(second.url()).origin },
      data: {
        action: "register",
        trip: f.trip,
        device: randomUUID(),
        token: "f".repeat(64),
      },
    });
    expect(denied.status()).toBe(403);
    expect((await denied.json()).code).toBe("DEVICE_RESET_REQUIRED");
    expect((await f.admin.workspace(f.trip)).visits).toHaveLength(0);
  } finally {
    await secondContext.close();
    await context.setOffline(false);
  }
  await expect(page.getByText("All synced", { exact: true })).toBeVisible({
    timeout: 30000,
  });
  const confirmed = await f.admin.workspace(f.trip);
  expect(confirmed.visits).toHaveLength(1);
  expect(confirmed.items.reduce((n, i) => n + i.full_jars, 0)).toBe(3);
  await expect(page.getByTestId("pending-sync-count")).toHaveText("All synced");
});
async function sale(page: Page, full: number, paid = true, submit = true) {
  const form = formFor(page);
  await form
    .getByRole("button", { name: "Refresh customer", exact: true })
    .click();
  await form.getByLabel("Jars Delivered", { exact: true }).fill(String(full));
  if (paid)
    await form
      .getByLabel("Total Amount Received (NPR)", { exact: true })
      .fill((full * 150.25).toFixed(2));
  else await form.getByRole("button", { name: "Credit", exact: true }).click();
  await form
    .getByRole("button", { name: "Review delivery", exact: true })
    .click();
  if (!submit) return;
  await form
    .getByRole("button", { name: "Save Delivery", exact: true })
    .click();
}
async function nav(page: Page, label: string) {
  await page
    .getByRole("navigation")
    .getByRole("link", { name: label, exact: true })
    .click();
}
test("one interface: 100 loaded, 20 online, 15 offline, reopen, automatic confirmation exactly once on another admin device", async ({
  page,
  context,
  request,
  browser,
}) => {
  page.on("dialog", (d) => d.accept());
  const f = await activeFixtureTrip(request);
  await login(page);
  await expect(page.getByTestId("driver-remaining-full-jars")).toHaveText(
    "100",
  );
  await nav(page, "New Sale");
  await expect(page).toHaveURL(/\/driver\/delivery$/);
  await expect(
    formFor(page).getByRole("button", { name: "Review delivery", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Offline passphrase")).toHaveCount(0);
  await prepare(page);
  await sale(page, 20);
  await expect(
    formFor(page).getByText("Saved on phone", { exact: true }),
  ).toBeVisible();
  await expect
    .poll(async () => (await f.admin.workspace(f.trip)).visits.length)
    .toBe(1);
  await nav(page, "My Stock");
  await expect(page.getByTestId("driver-remaining-full-jars")).toHaveText("80");
  await nav(page, "New Sale");
  await context.setOffline(true);
  await expect(
    page
      .getByTestId("driver-sync-status")
      .getByText("Offline", { exact: true }),
  ).toBeVisible();
  await sale(page, 15, false);
  await expect(
    formFor(page).getByText("Saved on phone", { exact: true }),
  ).toBeVisible();
  await nav(page, "My Stock");
  await expect(page.getByTestId("driver-remaining-full-jars")).toHaveText("65");
  await expect
    .poll(async () => (await f.admin.workspace(f.trip)).visits.length)
    .toBe(1);
  await page.reload();
  await expect(page).toHaveURL(/\/driver\/home$/);
  await page.getByRole("button", { name: "English", exact: true }).click();

  await expect(page.getByTestId("driver-remaining-full-jars")).toHaveText("65");
  await nav(page, "Sales History");
  await expect(page.getByText(/Saved on Device/).first()).toBeVisible();
  await context.setOffline(false);
  await expect(page.getByText("All synced", { exact: true })).toBeVisible({
    timeout: 45000,
  });
  await expect(page.getByTestId("pending-sync-count")).toHaveText("All synced");
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  const w = await f.admin.workspace(f.trip);
  expect(w.visits).toHaveLength(2);
  expect(w.items.reduce((n, i) => n + i.full_jars, 0)).toBe(35);
  expect(
    w.balances.find(
      (b) =>
        b.stock_kind === "FULL_JAR" &&
        b.location_id === w.vehicles[0]!.location_id,
    )?.quantity,
  ).toBe(65);
  const finance = await f.admin.rpc<FinanceWorkspace>("finance_workspace", {});
  expect(finance.invoices).toHaveLength(2);
  expect(finance.payments).toHaveLength(1);
  expect(finance.credit[0]?.outstanding).toBe("2253.75");
  const adminContext = await browser.newContext();
  try {
    const admin = await adminContext.newPage();
    await login(admin, "admin");
    await admin.goto(`/admin/trips/${f.trip}`);
    await expect(
      admin
        .getByRole("region", { name: "Delivery stock", exact: true })
        .getByTestId("driver-full-jars-sold"),
    ).toHaveText("35");
    await expect(
      admin
        .getByRole("region", { name: "Delivery stock", exact: true })
        .getByTestId("driver-remaining-full-jars"),
    ).toHaveText("65");
  } finally {
    await adminContext.close();
  }
});
test("cached customer details remain usable when online refresh requests fail", async ({
  page,
  request,
}) => {
  await activeFixtureTrip(request);
  await login(page);
  await prepare(page);
  await nav(page, "New Sale");
  await page.route("**/api/driver/customers/*/context*", (route) =>
    route.fulfill({ status: 503, json: { code: "SCHEMA" } }),
  );
  await formFor(page)
    .getByRole("button", { name: "Refresh customer", exact: true })
    .click();
  await formFor(page).getByLabel("Jars Delivered", { exact: true }).fill("3");
  await expect(
    formFor(page).getByRole("button", { name: "Review delivery", exact: true }),
  ).toBeEnabled();
});

test("a lost online acknowledgement is reconciled after reopening without posting the sale or payment twice", async ({
  page,
  context,
  request,
}) => {
  page.on("dialog", (d) => d.accept());
  const fixture = await activeFixtureTrip(request);
  await login(page);
  await prepare(page);
  await nav(page, "New Sale");
  const keys: string[] = [];
  await page.route("**/api/driver/offline", async (route) => {
    const body =
      route.request().method() === "POST"
        ? route.request().postDataJSON()
        : undefined;
    if (body?.action !== "post") {
      await route.continue();
      return;
    }
    keys.push(body.operation.id);
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    await context.setOffline(true);
    await route.abort("failed");
  });
  const key = await formFor(page).locator('input[name="key"]').inputValue();
  await sale(page, 2);
  await expect(
    formFor(page).getByText("Saved on phone", { exact: true }),
  ).toBeVisible();
  await expect
    .poll(
      async () => (await fixture.admin.workspace(fixture.trip)).visits.length,
    )
    .toBe(1);
  await page.unroute("**/api/driver/offline");
  await nav(page, "My Stock");
  await page.reload();
  await page.getByRole("button", { name: "English", exact: true }).click();

  await expect(page.getByTestId("driver-remaining-full-jars")).toHaveText("98");
  await context.setOffline(false);
  await expect(page.getByText("All synced", { exact: true })).toBeVisible({
    timeout: 45000,
  });
  expect(keys).toEqual([key]);
  const finance = await fixture.admin.rpc<FinanceWorkspace>(
    "finance_workspace",
    {},
  );
  expect(finance.sales).toHaveLength(1);
  expect(finance.payments).toHaveLength(1);
  expect(finance.invoices).toHaveLength(1);
  expect((await fixture.admin.workspace(fixture.trip)).items).toHaveLength(1);
  await expect(page.getByTestId("pending-sync-count")).toHaveText("All synced");
});
