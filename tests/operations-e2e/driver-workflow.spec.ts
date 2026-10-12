import { randomUUID } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import { fixtureClient } from "./fixture-client";
import type { FinanceWorkspace } from "../../src/domain/finance/types";
async function login(page: Page, role: string) {
  await page.goto("/sign-in");
  await page.getByLabel("Email address").fill(`${role}@fixture.example`);
  await page.getByLabel("Password", { exact: true }).fill("fixture-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(
    role === "admin" ? /admin\/dashboard/ : /driver\/home/,
  );
}
async function logout(page: Page) {
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/sign-in/);
}
async function save(page: Page, label: string) {
  const response = page.waitForResponse(
    (r) =>
      r.request().method() === "POST" && !!r.request().headers()["next-action"],
  );
  await page.getByRole("button", { name: label, exact: true }).click();
  expect((await response).ok()).toBe(true);
}
test("driver selects destinations, creates/edits contacts inside delivery, records 70 of 80 jars, and admin verifies every operation", async ({
  page,
  request,
}) => {
  page.on("dialog", (dialog) => dialog.accept());
  await request.post("http://127.0.0.1:17777/reset");
  const admin = await fixtureClient(request);
  const existing = randomUUID();
  await admin.rpc("save_customer", {
    p_id: existing,
    p_name: "Existing shop",
    p_shop: "Known shop",
    p_phone: "9800000001",
    p_address: "Kathmandu",
    p_notes: "",
    p_active: true,
    p_version: 0,
    p_reason: "Disposable customer",
    p_key: randomUUID(),
  });
  await login(page, "admin");
  await page.goto("/admin/vehicles");
  await page.getByLabel("Number plate").fill("TEST-DRIVER-80");
  await page.getByLabel("Reason for this change").fill("Disposable vehicle");
  await save(page, "Register vehicle");
  await page.goto("/admin/trips");
  await page
    .getByLabel("Driver", { exact: true })
    .selectOption({ label: "Fixture driver" });
  await page
    .getByLabel("Vehicle", { exact: true })
    .selectOption({ label: "TEST-DRIVER-80" });
  await expect(
    page.getByText("Assigned customers", { exact: true }),
  ).toHaveCount(0);
  await save(page, "Create draft trip");
  await page
    .getByRole("link", { name: "Open saved trip", exact: true })
    .click();
  await expect(page).toHaveURL(/\/admin\/trips\/[0-9a-f-]+$/);
  const trip = page.url().split("/").at(-1)!;
  await expect(
    page.getByText("Add route customer", { exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("checkbox", { name: "20L test jar", exact: true })
    .check();
  await page.getByLabel("20L test jar load", { exact: true }).fill("80");
  await page
    .getByRole("checkbox", { name: "Test water carton", exact: true })
    .check();
  await page.getByLabel("Test water carton load", { exact: true }).fill("2");
  await save(page, "Confirm warehouse loading");
  await expect
    .poll(async () => (await admin.workspace(trip)).trips[0]?.status)
    .toBe("LOADED");
  expect((await admin.workspace(trip)).route).toHaveLength(0);
  await logout(page);
  await login(page, "driver");
  await save(page, "Start delivering");
  await expect(
    page
      .locator("main")
      .getByRole("link", { name: "New Delivery", exact: true }),
  ).toBeVisible();
  for (const heading of [
    "My Active Trip",
    "Total Jars Loaded",
    "Remaining Full Jars",
    "Full Jars Sold",
    "Empty Jars Collected",
  ])
    await expect(
      page.getByRole("heading", { name: heading, exact: true }),
    ).toBeVisible();
  await page
    .locator("main")
    .getByRole("link", { name: "New Delivery", exact: true })
    .click();
  // Historical trip detail remains a supported operational entry point.
  await page.goto(`/driver/trips/${trip}`);
  await page
    .getByRole("button", { name: "Increase Full jars delivered", exact: true })
    .click();
  await expect(
    page.getByLabel("Full jars delivered", { exact: true }),
  ).toHaveValue("1");
  await page
    .getByRole("button", { name: "Decrease Full jars delivered", exact: true })
    .click();
  await page.getByLabel("Full jars delivered", { exact: true }).fill("20");
  await page.getByLabel("Empty jars collected", { exact: true }).fill("5");
  await page
    .getByRole("button", { name: "Add New Customer", exact: true })
    .click();
  await page
    .getByLabel("Customer name", { exact: true })
    .fill("Driver customer");
  await page
    .getByLabel("Shop name (optional)", { exact: true })
    .fill("Roadside shop");
  await page
    .getByLabel("Customer phone (optional)", { exact: true })
    .fill("9812345678");
  await save(page, "Save and select customer");
  await expect(
    page.getByText("Selected: Driver customer", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Full jars delivered", { exact: true }),
  ).toHaveValue("20");
  await expect(
    page.getByLabel("Empty jars collected", { exact: true }),
  ).toHaveValue("5");
  const created = (await admin.workspace()).customers.find(
    (c) => c.name === "Driver customer",
  )!.id;
  await page
    .getByRole("button", { name: "Edit customer contact", exact: true })
    .click();
  await page
    .getByLabel("Customer phone (optional)", { exact: true })
    .fill("9812345679");
  await save(page, "Save contact details");
  await expect
    .poll(
      async () =>
        (await admin.workspace()).customers.find((c) => c.id === created)
          ?.phone,
    )
    .toBe("9812345679");
  await page.getByLabel("Cartons delivered", { exact: true }).fill("1");
  await expect(
    page.getByRole("button", { name: "Review delivery", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Review delivery", exact: true })
    .click();
  await save(page, "Save Delivery");
  await expect
    .poll(async () => (await admin.workspace(trip)).visits.length)
    .toBe(1);
  await page.reload();
  await page
    .getByLabel("Search active customers", { exact: true })
    .fill("Known shop");
  await page.getByRole("button", { name: /Existing shop/ }).click();
  await page.getByLabel("Full jars delivered", { exact: true }).fill("25");
  await page.getByLabel("Empty jars collected", { exact: true }).fill("15");
  await page
    .getByRole("button", { name: "Partial payment", exact: true })
    .click();
  await page
    .getByLabel("Amount received for this invoice (NPR)", { exact: true })
    .fill("1000");
  await expect(
    page.getByRole("button", { name: "Review delivery", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Review delivery", exact: true })
    .click();
  await save(page, "Save Delivery");
  await expect
    .poll(async () => (await admin.workspace(trip)).visits.length)
    .toBe(2);
  await page.reload();
  await page.getByRole("button", { name: "Walk-in", exact: true }).click();
  await page.getByLabel("Full jars delivered", { exact: true }).fill("10");
  await page.getByLabel("Empty jars collected", { exact: true }).fill("10");
  await expect(
    page.getByRole("button", { name: "Review delivery", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Review delivery", exact: true })
    .click();
  await save(page, "Save Delivery");
  await expect
    .poll(async () => (await admin.workspace(trip)).visits.length)
    .toBe(3);
  await page.reload();
  await page
    .getByRole("button", { name: /Driver customer · Roadside shop/ })
    .click();
  await page.getByLabel("Full jars delivered", { exact: true }).fill("15");
  await page.getByLabel("Empty jars collected", { exact: true }).fill("10");
  await page
    .getByRole("button", { name: "Monthly credit / unpaid", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Review delivery", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Review delivery", exact: true })
    .click();
  await save(page, "Save Delivery");
  await expect
    .poll(async () => (await admin.workspace(trip)).visits.length)
    .toBe(4);
  await page.reload();
  await expect(
    page.getByText("Driver customer · 2 visits", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Full jars counted", { exact: true }),
  ).toHaveValue("10");
  await expect(
    page.getByLabel("Empty jars counted", { exact: true }),
  ).toHaveValue("40");
  await page
    .getByRole("button", { name: /Driver customer · Roadside shop/ })
    .click();
  await page.getByLabel("Full jars delivered", { exact: true }).fill("11");
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "exceeds the remaining vehicle stock" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Review delivery", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("Full jars delivered", { exact: true }).fill("0");
  await page
    .getByLabel("Collection customer", { exact: true })
    .selectOption(existing);
  await page
    .getByLabel("Credit amount received (NPR)", { exact: true })
    .fill("50");
  await expect(
    page.getByRole("button", {
      name: "Collect outstanding credit",
      exact: true,
    }),
  ).toBeVisible();
  await save(page, "Collect outstanding credit");
  const finance = () => admin.rpc<FinanceWorkspace>("finance_workspace", {});
  await expect.poll(async () => (await finance()).payments.length).toBe(4);
  await page.reload();
  const before = await admin.workspace(trip);
  await save(page, "Submit warehouse returns");
  await expect
    .poll(async () => (await admin.workspace(trip)).trips[0]?.status)
    .toBe("SUBMITTED");
  expect((await admin.workspace(trip)).movements).toHaveLength(
    before.movements.length,
  );
  await expect(
    page.getByRole("button", { name: "Save Delivery", exact: true }),
  ).toHaveCount(0);
  await logout(page);
  await login(page, "admin");
  await page.goto("/admin/customers");
  await expect(
    page.getByRole("link", { name: /Driver customer/ }),
  ).toContainText("Added by Fixture driver");
  await page.goto(`/admin/trips/${trip}`);
  await expect(
    page.getByText("Driver customer · 2 visits", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Walk-in customer", { exact: true }).first(),
  ).toBeVisible();
  await page
    .getByLabel("Verification / discrepancy reason", { exact: true })
    .fill("Actual returns counted in disposable test");
  await save(page, "Post physical verification");
  await expect
    .poll(async () => (await admin.workspace(trip)).trips[0]?.status)
    .toBe("CLOSED");
  const f = await finance();
  expect(f.invoices).toHaveLength(4);
  expect(f.payments).toHaveLength(4);
  expect(
    f.journal
      .filter((j) => j.account === "SALES")
      .reduce((n, j) => n + Number(j.amount), 0),
  ).toBe(-10667.75);
  expect(
    f.journal
      .filter((j) => j.account === "CASH")
      .reduce((n, j) => n + Number(j.amount), 0),
  ).toBe(5707.75);
  expect(
    (await admin.workspace(trip)).balances.every((b) => b.quantity >= 0),
  ).toBe(true);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await logout(page);
  await login(page, "other");
  await page.goto(`/driver/trips/${trip}`);
  await expect(
    page.getByRole("heading", { name: "Page not found", exact: true }),
  ).toBeVisible();
  await page.goto("/admin/inventory");
  await expect(page).toHaveURL(/driver\/home/);
});
