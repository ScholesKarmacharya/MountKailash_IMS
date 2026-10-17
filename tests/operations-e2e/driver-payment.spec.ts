import { saveDriverRecord } from "./fixture-client";
import { test, expect, type Page } from "@playwright/test";
import { activeFixtureTrip, openAdminMenuForSignOut } from "./fixture-client";
import type { FinanceWorkspace } from "../../src/domain/finance/types";
import { message } from "../../src/lib/i18n/messages";
async function language(page: Page, locale: "en" | "ne") {
  const saved = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/preferences") && r.request().method() === "POST",
  );
  await page
    .getByRole("button", {
      name: locale === "en" ? "English" : "नेपाली",
      exact: true,
    })
    .click();
  expect((await saved).ok()).toBe(true);
}
async function login(page: Page, role = "driver") {
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "English", exact: true }).click();
  await page.getByLabel("Email address").fill(`${role}@fixture.example`);
  await page.getByLabel("Password", { exact: true }).fill("fixture-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  if (role === "admin")
    await expect(
      page.getByRole("heading", {
        name: new RegExp(
          `^(Operations dashboard|${message("ne", "Operations dashboard")})$`,
        ),
      }),
    ).toBeVisible();
  else
    await expect(page.getByTestId("driver-remaining-full-jars")).toBeVisible();
  await language(page, "en");
}
async function save(page: Page) {
  await page
    .getByRole("button", { name: "Review delivery", exact: true })
    .click();
  await saveDriverRecord(page);
}
test("Paid and Credit validate amounts, preserve drafts across languages and update actual invoices and admin reports", async ({
  page,
  request,
}) => {
  const { admin, trip, customer } = await activeFixtureTrip(request);
  const finance = () => admin.rpc<FinanceWorkspace>("finance_workspace", {});
  page.on("dialog", (d) => d.accept());
  await login(page);
  await page.goto(`/driver/delivery?customer=${customer}`);
  const form = page.locator("form").filter({
    has: page.locator('input[name="operation"][value="driver-visit"]'),
  });
  await form.getByLabel("Jars Delivered", { exact: true }).fill("2");
  await form.getByLabel("Empty Jars Returned", { exact: true }).fill("1");
  const group = form.getByRole("group", {
    name: "Payment Status",
    exact: true,
  });
  await expect(group.getByRole("button")).toHaveCount(2);
  await expect(
    group.getByRole("button", { name: "Paid", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  for (const name of [
    "Cash",
    "Fonepay",
    "Monthly credit / unpaid",
    "Partial payment",
  ])
    await expect(form.getByRole("button", { name, exact: true })).toHaveCount(
      0,
    );
  await expect(
    form.getByLabel("Transaction reference (unverified)", { exact: true }),
  ).toHaveCount(0);
  const amount = form.getByLabel("Total Amount Received (NPR)", {
    exact: true,
  });
  const review = form.getByRole("button", {
    name: "Review delivery",
    exact: true,
  });
  await expect(amount).toHaveAttribute("inputmode", "decimal");
  await expect(amount).toHaveValue("300.50");
  await expect(review).toBeEnabled();
  const stock = await admin.workspace(trip);
  for (const wrong of ["300.49", "300.51"]) {
    await amount.fill(wrong);
    await expect(
      form
        .getByRole("alert")
        .filter({ hasText: "must equal the payable total" }),
    ).toBeVisible();
    await expect(review).toBeDisabled();
  }
  expect((await finance()).invoices).toHaveLength(0);
  expect((await admin.workspace(trip)).movements).toEqual(stock.movements);
  await amount.fill("300.50");
  await group.getByRole("button", { name: "Credit", exact: true }).click();
  await expect(amount).toHaveCount(0);
  await expect(group.getByRole("status")).toHaveText("Credit");
  await expect(form.locator('input[name="received_amount"]')).toHaveValue("");
  await group.getByRole("button", { name: "Paid", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(amount).toHaveValue("300.50");
  await language(page, "ne");
  const nepali = form.getByRole("group", {
    name: "भुक्तानी स्थिति",
    exact: true,
  });
  await expect(
    nepali.getByRole("button", { name: "भुक्तानी भयो", exact: true }),
  ).toBeVisible();
  await nepali.getByRole("button", { name: "उधारो", exact: true }).click();
  await expect(nepali.getByRole("status")).toHaveText("उधारो");
  await expect(
    form.getByLabel("प्राप्त भएको जम्मा रकम (NPR)", { exact: true }),
  ).toHaveCount(0);
  await nepali
    .getByRole("button", { name: "भुक्तानी भयो", exact: true })
    .click();
  await form
    .getByLabel("प्राप्त भएको जम्मा रकम (NPR)", { exact: true })
    .fill("३००.५०");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await language(page, "en");
  await expect(amount).toHaveValue("300.50");
  await save(page);
  await expect.poll(async () => (await finance()).invoices.length).toBe(1);
  let w = await finance();
  expect(w.invoices[0]).toMatchObject({ total: "300.50", outstanding: "0.00" });
  expect(w.payments).toHaveLength(1);
  expect(w.payments[0]).toMatchObject({
    amount: "300.50",
    method: "CASH",
    status: "CONFIRMED",
  });
  await page.goto(`/driver/delivery?customer=${customer}`);
  await form.getByLabel("Jars Delivered", { exact: true }).fill("2");
  await group.getByRole("button", { name: "Credit", exact: true }).click();
  await expect(amount).toHaveCount(0);
  await save(page);
  await expect.poll(async () => (await finance()).invoices.length).toBe(2);
  w = await finance();
  expect(w.payments).toHaveLength(1);
  expect(w.credit.find((i) => i.outstanding === "300.50")).toBeTruthy();
  await page.goto("/driver/delivery");
  await page.getByRole("button", { name: "Walk-in", exact: true }).click();
  await form.getByLabel("Jars Delivered", { exact: true }).fill("1");
  await form.getByLabel("Empty Jars Returned", { exact: true }).fill("1");
  await group.getByRole("button", { name: "Credit", exact: true }).click();
  await expect(
    form
      .getByRole("alert")
      .filter({ hasText: "Credit requires a registered customer" }),
  ).toBeVisible();
  await expect(review).toBeDisabled();
  await openAdminMenuForSignOut(page);
  await page.getByRole("button", { name: "Sign Out", exact: true }).click();
  await expect(page).toHaveURL(/sign-in/);
  await login(page, "admin");
  await page.goto("/admin/credit");
  const accountSummary = page
    .getByRole("heading", {
      name: "Customer account summary",
      exact: true,
    })
    .locator("..");
  const account = accountSummary
    .locator("tbody tr:visible, dl:visible")
    .filter({ hasText: "Refresh customer" });
  await expect(account).toHaveCount(1);
  await expect(account.getByText("NPR 300.50", { exact: true })).toBeVisible();
  await page.goto("/admin/dashboard");
  for (const label of ["Confirmed Collections", "Total Outstanding Credit"])
    await expect(
      page
        .getByRole("heading", { name: label, exact: true })
        .locator("..")
        .getByText("NPR 300.50", { exact: true }),
    ).toBeVisible();
  expect((await finance()).payments).toHaveLength(1);
  await page.reload();
  expect((await finance()).invoices).toHaveLength(2);
});
