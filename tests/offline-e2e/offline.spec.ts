import { test, expect, type Page } from "@playwright/test";
import {
  activeFixtureTrip,
  fixtureIds,
} from "../operations-e2e/fixture-client";
import type { FinanceWorkspace } from "../../src/domain/finance/types";
import { randomUUID } from "node:crypto";
import ne from "../../src/lib/i18n/ne.json";
test.beforeEach(({ page }) => {
  page.on("dialog", (d) => d.accept());
});
async function login(page: Page, role = "driver") {
  await page.goto("/sign-in");
  await page.getByLabel("Email address").fill(`${role}@fixture.example`);
  await page.getByLabel("Password", { exact: true }).fill("fixture-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(
    role === "admin" ? "**/admin/dashboard" : "**/driver/home",
  );
}
async function prepare(page: Page) {
  await login(page);
  await page.getByRole("button", { name: "English", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "English", exact: true }),
  ).toBeEnabled();
  await expect(page.getByTestId("driver-remaining-full-jars")).toBeVisible();
  await page
    .getByRole("button", { name: "Set up offline access", exact: true })
    .click();
  await page
    .getByLabel("Offline passphrase")
    .fill("offline-fixture-passphrase");
  await page
    .getByRole("button", { name: "Prepare this device online", exact: true })
    .click();
  await expect(page.getByTestId("driver-remaining-full-jars")).toHaveText(
    "100",
    {
      timeout: 30000,
    },
  );
  await expect(
    page.getByText("All Synced", { exact: false }).first(),
  ).toBeVisible();
}
async function sale(
  page: Page,
  full: number,
  empty: number,
  customer: string,
  payment = "Paid",
  expected = "Saved on Device",
) {
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "New Sale", exact: true })
    .click();
  await page.locator(`[data-customer-id="${customer}"]`).click();
  await page.getByLabel("Jars Delivered", { exact: true }).fill(String(full));
  await page
    .getByLabel("Empty Jars Returned", { exact: true })
    .fill(String(empty));
  await page.getByRole("button", { name: payment, exact: true }).click();
  if (payment === "Paid")
    await expect(
      page.getByLabel("Total Amount Received (NPR)", { exact: true }),
    ).toHaveValue((full * 150.25).toFixed(2));
  await page
    .getByRole("button", { name: "Review delivery", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Save Delivery", exact: true })
    .click();
  await expect(page.getByText(expected, { exact: true }).first()).toBeVisible();
}
test("offline paid and new-customer credit survive refresh, sync once, preserve dates, and seal a return", async ({
  page,
  context,
  request,
}) => {
  const f = await activeFixtureTrip(request);
  await prepare(page);
  await context.setOffline(true);
  await sale(page, 35, 30, f.customer);
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "My Stock", exact: true })
    .click();
  await expect(page.getByTestId("driver-remaining-full-jars")).toHaveText("65");
  await expect(page.getByTestId("driver-empty-jars-collected")).toHaveText(
    "30",
  );
  await page.reload();
  await page.getByRole("button", { name: "English", exact: true }).click();
  await page
    .getByLabel("Offline passphrase")
    .fill("offline-fixture-passphrase");
  await page
    .getByRole("button", { name: "Unlock device records", exact: true })
    .click();
  await expect(page.getByTestId("driver-remaining-full-jars")).toHaveText("65");
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "Customers", exact: true })
    .click();
  await page
    .getByLabel("Customer name", { exact: true })
    .fill("Offline customer");
  await page
    .getByRole("button", { name: "Save customer", exact: true })
    .click();
  await expect(
    page.getByText("Saved on Device", { exact: true }).first(),
  ).toBeVisible();
  const id = await page.evaluate(async () => {
    const r = indexedDB.open("mount-kailash-offline");
    return await new Promise<string>((resolve, reject) => {
      r.onerror = () => reject(r.error);
      r.onsuccess = () => {
        const t = r.result.transaction("vaults");
        const q = t.objectStore("vaults").getAll();
        q.onsuccess = () => {
          resolve(q.result[0].trip);
          r.result.close();
        };
      };
    });
  });
  expect(id).toBe(f.trip);
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "New Sale", exact: true })
    .click();
  const newCustomer = await page
    .getByRole("button", { name: "Offline customer", exact: true })
    .getAttribute("data-customer-id");
  await sale(page, 10, 0, newCustomer!, "Credit");
  await context.setOffline(false);
  await page
    .getByRole("button", { name: "Retry synchronization", exact: true })
    .click();
  await expect(
    page.getByText("All Synced", { exact: false }).first(),
  ).toBeVisible({ timeout: 30000 });
  const w = await f.admin.workspace(f.trip);
  expect(w.visits).toHaveLength(2);
  expect(w.items.reduce((n, i) => n + i.full_jars, 0)).toBe(45);
  expect(w.items.reduce((n, i) => n + i.empty_jars, 0)).toBe(30);
  const finance = await f.admin.rpc<FinanceWorkspace>("finance_workspace", {});
  expect(finance.payments).toHaveLength(1);
  expect(finance.invoices).toHaveLength(2);
  expect(
    finance.credit.find((c) => c.customer_id === newCustomer)?.outstanding,
  ).toBe("1502.50");
  await page
    .getByRole("button", { name: "Retry synchronization", exact: true })
    .click();
  expect((await f.admin.workspace(f.trip)).visits).toHaveLength(2);
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "Return to Warehouse", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Prepare return and seal device queue",
      exact: true,
    })
    .click();
  await expect(
    page.getByText(
      "This delivery round is sealed. No new sales can be recorded.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect
    .poll(async () => (await f.admin.workspace(f.trip)).trips[0]?.status)
    .toBe("SUBMITTED");
  await f.admin.rpc("reconcile_trip", {
    p_trip: f.trip,
    p_counts: [
      { product_id: fixtureIds.jar, stock_kind: "FULL_JAR", quantity: 55 },
      { product_id: fixtureIds.jar, stock_kind: "EMPTY_JAR", quantity: 30 },
    ],
    p_reason: "Isolated offline physical count",
    p_accept_variance: false,
    p_key: crypto.randomUUID(),
  });
  expect((await f.admin.workspace(f.trip)).trips[0]!.status).toBe("CLOSED");
  // Acknowledged sealed records stay encrypted while the next confirmed load
  // becomes the active online round automatically in the same mounted layout.
  const closed = (await f.admin.workspace(f.trip)).trips[0]!,
    next = randomUUID();
  await expect(page.getByText("All Synced", { exact: true })).toBeVisible({
    timeout: 30000,
  });
  await f.admin.rpc("create_trip", {
    p_id: next,
    p_driver: fixtureIds.driver,
    p_vehicle: closed.vehicle_id,
    p_day: closed.business_day_id,
    p_customers: [],
    p_notes: "Second isolated round",
    p_key: randomUUID(),
  });
  await f.admin.rpc("load_trip", {
    p_trip: next,
    p_items: [
      { product_id: fixtureIds.jar, stock_kind: "FULL_JAR", quantity: 30 },
    ],
    p_key: randomUUID(),
  });
  await f.driver.rpc("transition_trip", {
    p_trip: next,
    p_action: "START",
    p_reason: "",
    p_key: randomUUID(),
  });
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "My Stock", exact: true })
    .click();
  await expect(page.getByTestId("driver-remaining-full-jars")).toHaveText(
    "30",
    { timeout: 30000 },
  );
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "New Sale", exact: true })
    .click();
  await sale(page, 5, 0, f.customer, "Credit", "Saved to Supabase.");
  await expect(
    page
      .locator("#add-delivery")
      .getByText("Saved to Supabase.", { exact: true }),
  ).toBeVisible();
  expect(
    (await f.admin.workspace(next)).items.reduce((n, i) => n + i.full_jars, 0),
  ).toBe(5);
});
test("incorrect paid amount is blocked, carton-only delivery saves offline and Nepali messages fit mobile", async ({
  page,
  context,
  request,
}) => {
  const fixture = await activeFixtureTrip(request, 100, 10);
  await prepare(page);
  await context.setOffline(true);
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "New Sale", exact: true })
    .click();
  await page.locator('[data-customer-id="' + fixture.customer + '"]').click();
  await page.getByLabel("Cartons Delivered", { exact: true }).fill("5");
  await page
    .getByLabel("Total Amount Received (NPR)", { exact: true })
    .fill("1.00");
  await expect(
    page.getByRole("button", { name: "Review delivery", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("alert").filter({ hasText: "equal" }),
  ).toBeVisible();
  expect((await fixture.admin.workspace(fixture.trip)).visits).toHaveLength(0);
  await page
    .getByLabel("Total Amount Received (NPR)", { exact: true })
    .fill("751.25");
  await page
    .getByRole("button", { name: "Review delivery", exact: true })
    .click();
  await expect(
    page
      .getByRole("region", { name: "Test water carton" })
      .getByRole("definition"),
  ).toHaveText("5");
  await expect(
    page
      .getByRole("region", { name: "Test water carton" })
      .getByText("Jars Delivered", { exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Save Delivery", exact: true })
    .click();
  await expect(
    page.getByText("Saved on Device", { exact: true }).first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "नेपाली", exact: true }).click();
  await expect(
    page
      .getByTestId("driver-sync-status")
      .getByText(ne["Offline"], { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("online customer selection refreshes encrypted customer prices without losing quantities or received amount", async ({
  page,
  request,
}) => {
  const f = await activeFixtureTrip(request);
  await prepare(page);
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "New Sale", exact: true })
    .click();
  await page.locator(`[data-customer-id="${f.customer}"]`).click();
  await page.getByLabel("Jars Delivered", { exact: true }).fill("2");
  await page.getByRole("button", { name: "Paid", exact: true }).click();
  // Edit the amount explicitly; it now starts with the full invoice total.
  await page
    .getByLabel("Total Amount Received (NPR)", { exact: true })
    .fill("300.00");
  await page
    .getByLabel("Total Amount Received (NPR)", { exact: true })
    .fill("300.50");
  await f.admin.rpc("finance_command", {
    p_operation: "PRICE",
    p_data: {
      customer: f.customer,
      product: fixtureIds.jar,
      version: 0,
      price: "175.00",
      active: true,
      reason: "Customer specific browser fixture price",
    },
    p_key: randomUUID(),
  });
  const refreshed = page.waitForResponse(
    async (response) =>
      response.url().includes("/api/driver/offline") &&
      response.request().method() === "POST" &&
      response.request().postDataJSON().action === "snapshot",
  );
  await page.locator(`[data-customer-id="${f.customer}"]`).click();
  expect((await refreshed).status()).toBe(200);
  await expect(
    page.getByText("Total Amount: NPR 350.00", { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Jars Delivered", { exact: true })).toHaveValue(
    "2",
  );
  await expect(
    page.getByLabel("Total Amount Received (NPR)", { exact: true }),
  ).toHaveValue("300.50");
  await expect(
    page.getByRole("button", { name: "Review delivery", exact: true }),
  ).toBeDisabled();
  await page
    .getByLabel("Total Amount Received (NPR)", { exact: true })
    .fill("350.00");
  await page
    .getByRole("button", { name: "Review delivery", exact: true })
    .click();
  // Routine synchronization changes fetchedAt but leaves this review intact.
  const unchanged = page.waitForResponse(
    (r) =>
      r.url().includes("/api/driver/offline") &&
      r.request().method() === "POST" &&
      r.request().postDataJSON().action === "snapshot",
  );
  await page
    .getByRole("button", { name: "Retry synchronization", exact: true })
    .click();
  expect((await unchanged).status()).toBe(200);
  await expect(
    page.getByRole("button", { name: "Save Delivery", exact: true }),
  ).toBeVisible();
  expect((await f.admin.workspace(f.trip)).visits).toHaveLength(0);
  await f.admin.rpc("finance_command", {
    p_operation: "PRICE",
    p_data: {
      customer: f.customer,
      product: fixtureIds.jar,
      version: 1,
      price: "180.00",
      active: true,
      reason: "Meaningful pricing change requires another review",
    },
    p_key: randomUUID(),
  });
  const changed = page.waitForResponse(
    (r) =>
      r.url().includes("/api/driver/offline") &&
      r.request().method() === "POST" &&
      r.request().postDataJSON().action === "snapshot",
  );
  await page
    .getByRole("button", { name: "Retry synchronization", exact: true })
    .click();
  expect((await changed).status()).toBe(200);
  await expect(
    page.getByRole("button", { name: "Save Delivery", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByLabel("Jars Delivered", { exact: true })).toHaveValue(
    "2",
  );
  await expect(
    page.getByLabel("Total Amount Received (NPR)", { exact: true }),
  ).toHaveValue("350.00");
});
