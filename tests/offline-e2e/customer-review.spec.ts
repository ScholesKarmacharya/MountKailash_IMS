import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import {
  activeFixtureTrip,
  fixtureIds,
} from "../operations-e2e/fixture-client";
import { driverNavigate } from "./driver-navigation";
import type { FinanceWorkspace } from "../../src/domain/finance/types";

test("confirming a new regular customer does not close an unchanged delivery review", async ({
  page,
  request,
  context,
}) => {
  const f = await activeFixtureTrip(request);
  page.on("dialog", (d) => d.accept());
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "English", exact: true }).click();
  await page.getByLabel("Email address").fill("driver@fixture.example");
  await page.getByLabel("Password", { exact: true }).fill("fixture-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/driver/home");
  await page.getByRole("button", { name: "English", exact: true }).click();
  await expect(page.getByText("Offline ready", { exact: true })).toBeVisible({
    timeout: 30000,
  });
  await driverNavigate(page, "New Sale");
  await context.setOffline(true);
  await page
    .getByRole("button", { name: "Add New Customer", exact: true })
    .click();
  await page
    .getByLabel("Customer name", { exact: true })
    .fill("Offline review customer");
  await page
    .getByRole("button", { name: "Save and select customer", exact: true })
    .click();
  await expect(
    page.getByText("Selected: Offline review customer", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Jars Delivered", { exact: true }).fill("2");
  await page.getByLabel("Empty Jars Returned", { exact: true }).fill("1");
  await page
    .getByLabel("Total Amount Received (NPR)", { exact: true })
    .fill("300.49");
  await page
    .getByLabel("Total Amount Received (NPR)", { exact: true })
    .fill("300.50");
  await page
    .getByRole("button", { name: "Review delivery", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Save Delivery", exact: true }),
  ).toBeVisible();
  expect(
    (await f.admin.workspace()).customers.some(
      (c) => c.name === "Offline review customer",
    ),
  ).toBe(false);
  await context.setOffline(false);
  await expect
    .poll(async () =>
      (await f.admin.workspace()).customers.some(
        (c) => c.name === "Offline review customer",
      ),
    )
    .toBe(true);
  await expect(page.getByText("All synced", { exact: true })).toBeVisible({
    timeout: 30000,
  });
  await expect(
    page.getByRole("button", { name: "Save Delivery", exact: true }),
  ).toBeEnabled();
  const confirmed = page.getByRole("region", {
    name: "20L test jar",
    exact: true,
  });
  await expect(
    confirmed
      .getByText("Jars Delivered", { exact: true })
      .locator("..")
      .locator("dd"),
  ).toHaveText("2");
  await expect(
    confirmed
      .getByText("Empty Jars Returned", { exact: true })
      .locator("..")
      .locator("dd"),
  ).toHaveText("1");
  // A real customer-price change must still invalidate this reviewed sale,
  // preserving the amount the driver actually entered until it is corrected.
  const customer = (await f.admin.workspace()).customers.find(
    (c) => c.name === "Offline review customer",
  )!;
  await f.admin.rpc("finance_command", {
    p_operation: "PRICE",
    p_data: {
      customer: customer.id,
      product: fixtureIds.jar,
      version: 0,
      price: "155.25",
      active: true,
      reason: "Disposable meaningful pricing change",
    },
    p_key: randomUUID(),
  });
  const snapshot = page.waitForResponse(
    (r) =>
      r.url().includes("/api/driver/offline") &&
      r.request().method() === "POST" &&
      r.request().postDataJSON()?.action === "snapshot",
  );
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  expect((await snapshot).ok()).toBe(true);
  await expect(
    page.getByRole("button", { name: "Save Delivery", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByLabel("Total Amount Received (NPR)", { exact: true }),
  ).toHaveValue("300.50");
  await page
    .getByLabel("Total Amount Received (NPR)", { exact: true })
    .fill("310.50");
  await page
    .getByRole("button", { name: "Review delivery", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Save Delivery", exact: true })
    .click();
  await expect
    .poll(async () => (await f.admin.workspace(f.trip)).visits.length)
    .toBe(1);
  const finance = await f.admin.rpc<FinanceWorkspace>("finance_workspace", {});
  expect(finance.invoices).toHaveLength(1);
  expect(finance.invoices[0]).toMatchObject({
    total: "310.50",
    outstanding: "0.00",
  });
  expect(finance.payments).toHaveLength(1);
});
