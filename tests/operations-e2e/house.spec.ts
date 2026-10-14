import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { activeFixtureTrip } from "./fixture-client";
import type { FinanceWorkspace } from "../../src/domain/finance/types";
import type { HouseWorkspace } from "../../src/domain/house/types";
async function login(page: Page, role: string) {
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "English", exact: true }).click();
  await page.getByLabel("Email address").fill(`${role}@fixture.example`);
  await page.getByLabel("Password", { exact: true }).fill("fixture-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(
    role === "admin" ? "**/admin/dashboard" : "**/driver/home",
  );
  await page.getByRole("button", { name: "English", exact: true }).click();
}
test("admin creates approved HOUSE; driver delivers 15/10 free; reports and bilingual exports stay separate from revenue", async ({
  page,
  request,
}) => {
  const f = await activeFixtureTrip(request);
  page.on("dialog", (d) => d.accept());
  await login(page, "admin");
  await page.goto("/admin/customers");
  const form = page.locator("form").filter({
    has: page.getByRole("button", { name: "Create customer", exact: true }),
  });
  await form.getByLabel("Customer Type", { exact: true }).selectOption("HOUSE");
  await form
    .getByLabel("Approval Status", { exact: true })
    .selectOption("APPROVED");
  await form.getByLabel("Customer name", { exact: true }).fill("Owner's House");
  await form
    .getByLabel("Contact person (optional)", { exact: true })
    .fill("Owner");
  await form.getByLabel("Address", { exact: true }).fill("Kathmandu");
  await form
    .getByLabel("Reason for this change", { exact: true })
    .fill("Owner approved family supply");
  await form
    .getByRole("button", { name: "Create customer", exact: true })
    .click();
  await expect(page.getByText("Record saved.", { exact: true })).toBeVisible();
  const house = (await f.admin.workspace()).customers.find(
    (c) => c.name === "Owner's House",
  )!;
  expect(house.house_status).toBe("APPROVED");
  await page.getByRole("button", { name: "Sign Out", exact: true }).click();
  await page.waitForURL("**/sign-in");
  await login(page, "driver");
  await page.goto(`/driver/delivery?customer=${house.id}`);
  const sale = page.locator("form").filter({
    has: page.locator('input[name="operation"][value="driver-visit"]'),
  });
  await sale.getByLabel("Jars Delivered", { exact: true }).fill("15");
  await sale.getByLabel("Empty Jars Returned", { exact: true }).fill("10");
  await expect(
    sale.getByText("No Payment Required", { exact: true }),
  ).toBeVisible();
  await expect(
    sale.getByRole("button", { name: "Paid", exact: true }),
  ).toHaveCount(0);
  await expect(
    sale.getByLabel("Total Amount Received (NPR)", { exact: true }),
  ).toHaveCount(0);
  await sale
    .getByRole("button", { name: "Review delivery", exact: true })
    .click();
  await sale
    .getByRole("button", { name: "Save Delivery", exact: true })
    .click();
  await expect(
    sale.getByText("Saved to Supabase.", { exact: true }),
  ).toBeVisible();
  const finances = await f.admin.rpc<FinanceWorkspace>("finance_workspace", {});
  expect(finances.invoices[0]?.total).toBe("0.00");
  expect(finances.payments).toHaveLength(0);
  expect(finances.credit).toHaveLength(0);
  const r = await f.admin.rpc<HouseWorkspace>("house_workspace", {
    p_start: "2000-01-01",
    p_end: "2100-01-01",
    p_customer: house.id,
    p_driver: null,
    p_product: null,
  });
  expect(r.rows[0]?.reference_value).toBe("2253.75");
  expect((await f.admin.workspace(f.trip)).custody[0]?.quantity).toBe(5);
  await page.goto("/driver/sales");
  await expect(
    page.getByText("Payment Status: Free Supply", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Sign Out", exact: true }).click();
  await page.waitForURL("**/sign-in");
  await login(page, "admin");
  await page.goto("/admin/pricing");
  await expect(
    page.getByRole("heading", { name: "Pricing & Free Supply", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("link", { name: "Owner's House", exact: true })
      .filter({ visible: true }),
  ).toBeVisible();
  const pdf = await page.request.get(
    "/api/free-supply/export?preset=today&format=pdf",
  );
  expect(pdf.ok()).toBe(true);
  expect(pdf.headers()["content-type"]).toContain("application/pdf");
  expect((await pdf.body()).subarray(0, 4).toString()).toBe("%PDF");
  const excel = await page.request.get(
    "/api/free-supply/export?preset=today&format=xlsx",
  );
  expect(excel.ok()).toBe(true);
  expect((await excel.body()).readUInt32LE()).toBe(0x04034b50);
  await page.getByRole("button", { name: "नेपाली", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: "मूल्य निर्धारण र निःशुल्क वितरण",
      exact: true,
    }),
  ).toBeVisible();
});
test("HOUSE jars free with charged cartons keeps payment controls and charges only carton value", async ({
  page,
  request,
}) => {
  const f = await activeFixtureTrip(request, 100, 10);
  await f.admin.rpc("save_house_customer", {
    p_id: f.customer,
    p_name: "Mixed House",
    p_shop: "",
    p_phone: "",
    p_address: "",
    p_notes: "",
    p_active: true,
    p_version: 1,
    p_reason: "Approved mixed supply",
    p_key: randomUUID(),
    p_contact_person: "",
    p_supply_type: "HOUSE",
    p_house_status: "APPROVED",
  });
  await login(page, "driver");
  await page.goto(`/driver/delivery?customer=${f.customer}`);
  const form = page.locator("form").filter({
    has: page.locator('input[name="operation"][value="driver-visit"]'),
  });
  await form.getByLabel("Jars Delivered", { exact: true }).fill("15");
  await form.getByLabel("Empty Jars Returned", { exact: true }).fill("10");
  await form.getByLabel("Cartons Delivered", { exact: true }).fill("2");
  await expect(
    form.getByRole("button", { name: "Paid", exact: true }),
  ).toBeVisible();
  await form
    .getByLabel("Total Amount Received (NPR)", { exact: true })
    .fill("300.50");
  await expect(
    form.getByRole("button", { name: "Review delivery", exact: true }),
  ).toBeEnabled();
});
