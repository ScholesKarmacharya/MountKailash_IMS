import { test, expect, type Page } from "@playwright/test";
import { activeFixtureTrip, fixtureClient } from "./fixture-client";
import type { FinanceWorkspace } from "../../src/domain/finance/types";
async function login(page: Page, role = "driver") {
  await page.goto("/sign-in");
  await page.getByLabel("Email address").fill(role + "@fixture.example");
  await page.getByLabel("Password", { exact: true }).fill("fixture-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(
    role === "admin" ? /admin\/dashboard/ : /driver\/home/,
  );
}
async function signout(page: Page) {
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/sign-in/);
}
async function save(page: Page, label: string) {
  const response = page.waitForResponse(
    (r) =>
      r.request().method() === "POST" &&
      r.request().headers()["next-action"] !== undefined,
  );
  await page.getByRole("button", { name: label, exact: true }).click();
  expect((await response).ok()).toBe(true);
  await expect(
    page.getByText("Record saved.", { exact: true }).last(),
  ).toBeVisible();
}
test("cash, partial Fonepay, old credit, deposit, reconciliation, invoices and isolation use real SQL", async ({
  page,
  request,
}) => {
  page.on("dialog", (d) => d.accept());
  const { admin, customer, trip } = await activeFixtureTrip(request);
  const finance = () => admin.rpc<FinanceWorkspace>("finance_workspace", {});
  await login(page, "admin");
  await page.goto("/admin/customers/" + customer);
  await page
    .getByLabel("Account type", { exact: true })
    .selectOption("MONTHLY_CREDIT");
  await page
    .getByLabel("Deposit arrangement", { exact: true })
    .selectOption("MANUAL");
  await page.getByLabel(/Invoice due after days/).fill("30");
  const billing = page.locator("form").filter({
    has: page.locator('input[name="operation"][value="finance:BILLING"]'),
  });
  await billing
    .getByLabel("Reason / evidence", { exact: true })
    .fill("Confirmed browser deposit arrangement");
  await save(page, "Save customer billing arrangement");
  await expect
    .poll(async () => (await finance()).billing[0]?.deposit_mode)
    .toBe("MANUAL");
  await signout(page);
  await login(page);
  await page.goto("/driver/trips/" + trip);
  await page
    .getByRole("button", { name: "Refresh customer", exact: true })
    .click();
  await page.getByLabel("Full jars delivered", { exact: true }).fill("4");
  await page.getByLabel("Empty jars collected", { exact: true }).fill("2");
  await page
    .getByRole("button", { name: "Partial payment", exact: true })
    .click();
  await page
    .getByLabel("Amount received for this invoice (NPR)", { exact: true })
    .fill("100");
  await page
    .getByLabel("Additional Fonepay amount (pending, NPR)", { exact: true })
    .fill("200");
  await page
    .getByLabel("Refundable jar deposit received (NPR)", { exact: true })
    .fill("300");
  await page
    .locator("form")
    .filter({ has: page.locator('input[name="operation"][value="visit"]') })
    .getByLabel("Transaction reference (unverified)", { exact: true })
    .fill("browser-reference");
  await expect(
    page.getByText("Payable: NPR 601.00", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Review delivery", exact: true })
    .click();
  await save(page, "Save Delivery");
  await expect.poll(async () => (await finance()).invoices.length).toBe(1);
  let f = await finance();
  const invoice = f.invoices[0]!;
  expect(invoice.outstanding).toBe("501.00");
  expect(invoice.available).toBe("301.00");
  expect(f.deposits[0]!.amount).toBe("300.00");
  await page.reload();
  await page
    .getByLabel("Collection customer", { exact: true })
    .selectOption(customer);
  await page
    .getByLabel("Credit amount received (NPR)", { exact: true })
    .fill("50");
  await save(page, "Collect outstanding credit");
  await expect
    .poll(async () => (await finance()).invoices[0]?.outstanding)
    .toBe("451.00");
  f = await finance();
  expect(f.sales).toHaveLength(1);
  await page.goto("/driver/invoices/" + invoice.id);
  await expect(
    page.getByText("Outstanding: NPR 451.00", { exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Invoice amount received (NPR)", { exact: true })
    .fill("50");
  await save(page, "Record invoice receipt");
  await expect
    .poll(async () => (await finance()).invoices[0]?.outstanding)
    .toBe("401.00");
  await page.reload();
  const pdf = await page.request.get("/api/invoices/" + invoice.id + "/pdf");
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()["content-type"]).toBe("application/pdf");
  expect(pdf.headers()["cache-control"]).toContain("no-store");
  expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
  const paymentPdf = await page.request.get(
    "/api/payments/" + (await finance()).payments[0]!.id + "/pdf",
  );
  expect(paymentPdf.status()).toBe(200);
  expect((await paymentPdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await signout(page);
  await login(page, "admin");
  f = await finance();
  const pending = f.payments.find((p) => p.status === "PENDING")!;
  await page.goto("/admin/payments/" + pending.id);
  await page
    .getByLabel("Reconciliation decision", { exact: true })
    .selectOption("CONFIRM");
  await page
    .getByLabel("Matched transaction reference", { exact: true })
    .fill("merchant-browser-unique");
  await page
    .getByLabel("Reason / evidence", { exact: true })
    .fill("Independently matched merchant statement");
  await save(page, "Save reconciliation decision");
  await expect
    .poll(
      async () =>
        (await finance()).payments.find((p) => p.id === pending.id)?.status,
    )
    .toBe("CONFIRMED");
  expect((await finance()).invoices[0]!.outstanding).toBe("201.00");
  await page.goto("/admin/payments");
  await expect(
    page.getByText("NPR 601.00", { exact: true }).first(),
  ).toBeVisible();
  await page.getByLabel("Method", { exact: true }).selectOption("FONEPAY");
  await page
    .getByRole("button", { name: "Filter history", exact: true })
    .click();
  await expect(
    page.getByRole("cell", { name: "FONEPAY", exact: true }),
  ).toHaveCount(1);
  await page.goto("/admin/customers/" + customer);
  const refund = page.locator("form").filter({
    has: page.locator('input[name="operation"][value="finance:REFUND"]'),
  });
  await refund
    .getByLabel("Actual cash refund (NPR)", { exact: true })
    .fill("150");
  await refund
    .getByLabel("Reason / evidence", { exact: true })
    .fill("Explicit customer cash refund");
  await save(page, "Record cash deposit refund");
  await expect.poll(async () => (await finance()).deposits.length).toBe(2);
  const deposit = (await finance()).deposits.find((d) => d.kind === "REFUND")!;
  const depositPdf = await page.request.get(
    "/api/deposits/" + deposit.id + "/pdf",
  );
  expect(depositPdf.status()).toBe(200);
  expect((await depositPdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
  await signout(page);
  await login(page);
  await page.goto("/driver/invoices/" + invoice.id);
  await expect(
    page.getByText("Outstanding: NPR 201.00", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText("Outstanding: NPR 201.00", { exact: true }),
  ).toBeVisible();
  await signout(page);
  await login(page, "other");
  await page.goto("/driver/invoices/" + invoice.id);
  await expect(page.getByRole("heading", { name: /not found/i })).toBeVisible();
  expect(
    (await page.request.get("/api/invoices/" + invoice.id + "/pdf")).status(),
  ).toBe(404);
  await page.goto("/admin/payments");
  await expect(page).toHaveURL(/driver\/home/);
  const other = await fixtureClient(request, "other");
  expect(
    (await other.rpc<FinanceWorkspace>("finance_workspace", {})).payments,
  ).toHaveLength(0);
});
