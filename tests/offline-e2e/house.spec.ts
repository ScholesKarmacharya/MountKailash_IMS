import { test, expect } from "@playwright/test";
import { driverNavigate } from "./driver-navigation";
import { randomUUID } from "node:crypto";
import { activeFixtureTrip } from "../operations-e2e/fixture-client";
import type { FinanceWorkspace } from "../../src/domain/finance/types";
test("approved HOUSE supplies free online then offline, survives reload and syncs exactly once with admin visibility", async ({
  page,
  context,
  request,
}) => {
  page.on("dialog", (dialog) => dialog.accept());
  const f = await activeFixtureTrip(request);
  await f.admin.rpc("save_house_customer", {
    p_id: f.customer,
    p_name: "Offline House",
    p_shop: "",
    p_phone: "",
    p_address: "",
    p_notes: "",
    p_active: true,
    p_version: 1,
    p_reason: "Approved offline supply",
    p_key: randomUUID(),
    p_contact_person: "Owner",
    p_supply_type: "HOUSE",
    p_house_status: "APPROVED",
  });
  await page.goto("/sign-in");
  await page.getByLabel("Email address").fill("driver@fixture.example");
  await page.getByLabel("Password", { exact: true }).fill("fixture-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/driver/home");
  await page.getByRole("button", { name: "English", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "English", exact: true }),
  ).toBeEnabled();
  await page.goto(`/driver/delivery?customer=${f.customer}`);
  await expect(page.getByText("Offline ready", { exact: true })).toBeVisible({
    timeout: 30000,
  });
  const onlineSale = page.locator("form").filter({
    has: page.locator('input[name="operation"][value="driver-visit"]'),
  });
  await onlineSale.getByLabel("Jars Delivered", { exact: true }).fill("15");
  await onlineSale
    .getByLabel("Empty Jars Returned", { exact: true })
    .fill("10");
  await expect(
    onlineSale.getByText("No Payment Required", { exact: true }),
  ).toBeVisible();
  await onlineSale
    .getByRole("button", { name: "Review delivery", exact: true })
    .click();
  const savedResponse = page.waitForResponse(
    (r) =>
      r.url().includes("/api/driver/offline") &&
      r.request().method() === "POST" &&
      r.request().postDataJSON()?.action === "post",
  );
  await onlineSale
    .getByRole("button", { name: "Save Delivery", exact: true })
    .click();
  const saved = await savedResponse;
  expect(saved.status()).toBe(200);
  await expect
    .poll(async () => (await f.admin.workspace(f.trip)).visits.length)
    .toBe(1);
  await page.goto("/offline");
  await page.getByRole("button", { name: "English", exact: true }).click();
  await expect(page.getByText("Offline ready", { exact: true })).toBeVisible({
    timeout: 30000,
  });

  await expect(page.getByTestId("driver-remaining-full-jars")).toHaveText(
    "85",
    {
      timeout: 30000,
    },
  );
  await expect(page.getByText("All synced", { exact: true })).toBeVisible({
    timeout: 30000,
  });
  await context.setOffline(true);
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "New Sale", exact: true })
    .click();
  await page.locator(`[data-customer-id="${f.customer}"]`).click();
  await page.getByLabel("Jars Delivered", { exact: true }).fill("5");
  await page.getByLabel("Empty Jars Returned", { exact: true }).fill("2");
  await expect(
    page.getByText("No Payment Required", { exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Paid", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Review delivery", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Save Delivery", exact: true })
    .click();
  await expect(
    page.getByText("Saved on phone", { exact: true }).first(),
  ).toBeVisible();
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "My Stock", exact: true })
    .click();
  await expect(page.getByTestId("driver-remaining-full-jars")).toHaveText("80");
  await page.reload();
  await page.getByRole("button", { name: "English", exact: true }).click();

  await expect(page.getByTestId("driver-remaining-full-jars")).toHaveText("80");
  await context.setOffline(false);
  await expect(page.getByText("All synced", { exact: true })).toBeVisible({
    timeout: 30000,
  });
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  const finances = await f.admin.rpc<FinanceWorkspace>("finance_workspace", {});
  expect(finances.sales).toHaveLength(2);
  expect(finances.sales[0]?.supply_classification).toBe("FREE_SUPPLY");
  expect(finances.invoices[0]?.total).toBe("0.00");
  expect(finances.payments).toHaveLength(0);
  expect(finances.credit).toHaveLength(0);
  expect(
    finances.sales.every((s) => s.supply_classification === "FREE_SUPPLY"),
  ).toBe(true);
  expect(finances.invoices.every((i) => i.total === "0.00")).toBe(true);
  const authoritative = await f.admin.workspace(f.trip);
  expect(authoritative.visits).toHaveLength(2);
  expect(
    authoritative.custody.find((c) => c.customer_id === f.customer)?.quantity,
  ).toBe(8);
  expect(
    authoritative.balances.find(
      (b) =>
        b.stock_kind === "FULL_JAR" &&
        b.location_id === authoritative.vehicles[0]?.location_id,
    )?.quantity,
  ).toBe(80);
  expect(
    authoritative.balances.find(
      (b) =>
        b.stock_kind === "EMPTY_JAR" &&
        b.location_id === authoritative.vehicles[0]?.location_id,
    )?.quantity,
  ).toBe(12);
  await expect(page.getByTestId("driver-remaining-full-jars")).toHaveText("80");
  await driverNavigate(page, "More");
  await page.getByRole("button", { name: "Sign Out", exact: true }).click();
  await page.waitForURL("**/sign-in");
  await page.getByRole("button", { name: "English", exact: true }).click();
  await page.getByLabel("Email address").fill("admin@fixture.example");
  await page.getByLabel("Password", { exact: true }).fill("fixture-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/admin/dashboard");
  await page.getByRole("button", { name: "English", exact: true }).click();
  await page.goto("/admin/pricing");
  const deliveries = page
    .getByTestId("free-delivery-history")
    .locator('[data-testid^="free-delivery-"]');
  await expect(deliveries).toHaveCount(2);
  await expect(deliveries.filter({ hasText: "15 jars" })).toHaveCount(1);
  await expect(deliveries.getByText(/(?:^|\s)5 jars$/)).toHaveCount(1);
});
