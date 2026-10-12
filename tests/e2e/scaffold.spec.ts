import { expect, test } from "@playwright/test";
test("sign-in explains missing configuration and has accessible fields", async ({
  page,
}) => {
  await page.goto("/sign-in");
  await expect(
    page.getByRole("heading", { name: "Welcome back" }),
  ).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Setup required");
  await expect(page.getByLabel("Email address")).toBeDisabled();
  await expect(page.getByLabel("Password", { exact: true })).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeDisabled();
});
for (const route of [
  "/admin",
  "/admin/dashboard",
  "/admin/products",
  "/admin/inventory",
  "/admin/payments",
  "/admin/credit",
  "/admin/billing",
  "/admin/daily-close",
  "/admin/reports",
  "/admin/refilling",
  "/admin/drivers",
  "/admin/drivers/00000000-0000-0000-0000-000000000011",
  "/account",
  "/account/profile",
  "/api/business-days/00000000-0000-0000-0000-000000000011/pdf",
  "/api/business-days/00000000-0000-0000-0000-000000000011/csv",
  "/api/business-days/export?format=csv",
  "/driver/invoices/00000000-0000-0000-0000-000000000011",
  "/api/invoices/00000000-0000-0000-0000-000000000011/pdf",
  "/api/payments/00000000-0000-0000-0000-000000000011/pdf",
  "/driver",
  "/driver/home",
  "/driver/delivery",
  "/driver/customers",
  "/driver/pending-jars",
  "/driver/sales",
  "/driver/return",
])
  test(`unauthenticated direct ${route} access is guarded`, async ({
    page,
  }) => {
    await page.goto(route);
    await expect(page).toHaveURL(/\/sign-in/);
    await expect(
      page.getByRole("heading", { name: "Welcome back" }),
    ).toBeVisible();
  });
