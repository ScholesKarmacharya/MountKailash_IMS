import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { activeFixtureTrip, fixtureIds } from "./fixture-client";
import type { FinanceWorkspace } from "../../src/domain/finance/types";

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
  await expect(page).toHaveURL(
    role === "admin" ? /admin\/dashboard/ : /driver\/home/,
  );
  await language(page, "en");
}
async function save(page: Page) {
  const response = page.waitForResponse(
    (r) =>
      r.request().method() === "POST" && !!r.request().headers()["next-action"],
  );
  await page
    .getByRole("button", { name: "Save Delivery", exact: true })
    .click();
  expect((await response).ok()).toBe(true);
  await expect(
    page.getByText(/^(Record saved\.|Saved to Supabase\.)$/).last(),
  ).toBeVisible();
}
async function pdfText(page: Page, url: string) {
  const response = await page.request.get(url);
  expect(response.ok()).toBe(true);
  expect(response.headers()["content-type"]).toContain("application/pdf");
  const task = getDocument({
    data: new Uint8Array(await response.body()),
    useSystemFonts: false,
  });
  const pdf = await task.promise;
  const texts: string[] = [];
  for (let p = 1; p <= pdf.numPages; p++)
    texts.push(
      (await (await pdf.getPage(p)).getTextContent()).items
        .map((i) => ("str" in i ? i.str : ""))
        .join(" "),
    );
  await task.destroy();
  return texts.join(" ");
}
function quantity(section: ReturnType<Page["getByRole"]>, label: string) {
  return section
    .locator("dt")
    .filter({ hasText: new RegExp("^" + label + "(?:\\s*\\(|$)") })
    .locator("..")
    .locator("dd");
}
test("carton-only sale has no jar fields in EN/NE forms, history, details, PDFs and admin reports", async ({
  page,
  request,
}) => {
  const { admin, customer, trip } = await activeFixtureTrip(request, 0, 10);
  let dialog = "";
  page.on("dialog", (d) => {
    dialog = d.message();
    return d.accept();
  });
  await login(page);
  await page.goto(`/driver/delivery?customer=${customer}`);
  await expect(page.getByLabel("Jars Delivered", { exact: true })).toHaveCount(
    0,
  );
  await expect(
    page.getByLabel("Empty Jars Returned", { exact: true }),
  ).toHaveCount(0);
  await page.getByLabel("Cartons Delivered", { exact: true }).fill("5");
  await page
    .getByLabel("Total Amount Received (NPR)", { exact: true })
    .fill("751.25");
  await language(page, "ne");
  await expect(
    page.getByLabel("डेलिभरी भएका कार्टुन", { exact: true }),
  ).toHaveValue("5");
  await expect(
    page.getByRole("heading", { name: "पानीका कार्टुन", exact: true }),
  ).toBeVisible();
  await language(page, "en");
  await page
    .getByRole("button", { name: "Review delivery", exact: true })
    .click();
  const section = page.getByRole("region", {
    name: "Test water carton",
    exact: true,
  });
  await expect(quantity(section, "Cartons Delivered")).toHaveText("5");
  await expect(
    section.getByText(/Jars Delivered|Empty Jars Returned|Unreturned Jars/),
  ).toHaveCount(0);
  await save(page);
  expect(dialog).toContain("Cartons Delivered: 5");
  expect(dialog).not.toMatch(
    /Jars Delivered|Empty Jars Returned|Unreturned Jars/,
  );
  const f = await admin.rpc<FinanceWorkspace>("finance_workspace", {});
  expect(f.invoices[0]).toMatchObject({ total: "751.25", outstanding: "0.00" });
  const invoice = f.invoices[0]!,
    payment = f.payments[0]!;
  const w = await admin.workspace(trip);
  expect(w.custody).toHaveLength(0);
  expect(w.movements.filter((m) => m.visit_id)).toHaveLength(1);
  expect(w.movements.find((m) => m.visit_id)?.stock_kind).toBe("BOTTLE_CARTON");
  await page.goto("/driver/sales");
  const sale = page
    .locator("li")
    .filter({ has: page.locator(`a[href="/driver/invoices/${invoice.id}"]`) });
  await expect(sale).toContainText("Cartons Delivered");
  await expect(sale).not.toContainText("Empty Jars Returned");
  await page.goto(`/driver/invoices/${invoice.id}`);
  await expect(page.getByText(/Cartons Delivered: 5/)).toBeVisible();
  await expect(
    page.getByText("Payment Status: Paid", { exact: true }),
  ).toBeVisible();
  for (const url of [
    `/api/invoices/${invoice.id}/pdf`,
    `/api/payments/${payment.id}/pdf`,
  ]) {
    const text = await pdfText(page, url);
    expect(text).toContain("Cartons Delivered: 5");
    expect(text).not.toMatch(
      /Jars Delivered|Empty Jars Returned|Unreturned Jars/,
    );
  }
  await language(page, "ne");
  await expect(page.getByText(/डेलिभरी भएका कार्टुन: ५/)).toBeVisible();
  const nePdf = (
    await pdfText(page, `/api/invoices/${invoice.id}/pdf`)
  ).replaceAll(/\s/g, "");
  expect(nePdf).toContain("डेिलभरीभएकाकाटुर्न:५");
  expect(nePdf).not.toContain("फिर्ताआएकाखालीजार");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await language(page, "en");
  await page.getByRole("button", { name: "Sign Out", exact: true }).click();
  await expect(page).toHaveURL(/sign-in/);
  await login(page, "admin");
  await page.goto(`/admin/customers/${customer}`);
  const history = page
    .getByRole("heading", { name: "Customer delivery history", exact: true })
    .locator("..");
  await expect(history).toContainText("Cartons Delivered");
  await expect(history).not.toContainText("Empty Jars Returned");
  const day = w.days.find((d) => d.status === "OPEN")!.id;
  await page.goto(`/admin/reports/${day}`);
  const products = page
    .getByRole("heading", { name: "Product totals", exact: true })
    .locator("..");
  await expect(products).toContainText("Cartons Delivered");
  await expect(products).not.toContainText("Unreturned Jars");
  const csv = await page.request.get(`/api/business-days/${day}/csv`);
  expect(csv.ok()).toBe(true);
  const productRow = (await csv.text())
    .split("\r\n")
    .find((line) => line.startsWith('"Product item sales"'))!;
  expect(productRow).toContain("Cartons Delivered: 5");
  expect(productRow).not.toContain("Empty Jars Returned");
  await page.reload();
  expect((await admin.workspace(trip)).movements).toEqual(w.movements);
});
test("jar and mixed sale confirmation separates visit change from previous custody and persists correct balances", async ({
  page,
  request,
}) => {
  const { admin, driver, customer, trip } = await activeFixtureTrip(
    request,
    100,
    10,
  );
  await driver.rpc("post_driver_delivery", {
    p_trip: trip,
    p_customer: customer,
    p_walk_name: "",
    p_walk_phone: "",
    p_items: [
      { product_id: fixtureIds.jar, full_jars: 10, empty_jars: 0, cartons: 0 },
    ],
    p_status: "CREDIT",
    p_received: null,
    p_notes: "",
    p_key: randomUUID(),
  });
  page.on("dialog", (d) => d.accept());
  await login(page);
  await page.goto(`/driver/delivery?customer=${customer}`);
  await page.getByLabel("Jars Delivered", { exact: true }).fill("12");
  await page.getByLabel("Empty Jars Returned", { exact: true }).fill("8");
  await page.getByRole("button", { name: "Credit", exact: true }).click();
  await page
    .getByRole("button", { name: "Review delivery", exact: true })
    .click();
  const jars = page.getByRole("region", { name: "20L test jar", exact: true });
  await expect(quantity(jars, "Jars Delivered")).toHaveText("12");
  await expect(quantity(jars, "Empty Jars Returned")).toHaveText("8");
  await expect(quantity(jars, "Unreturned Jars")).toHaveText("4");
  await expect(quantity(jars, "Previous unreturned jars")).toHaveText("10");
  await expect(quantity(jars, "Updated total unreturned jars")).toHaveText(
    "14",
  );
  await expect(
    page.getByRole("region", { name: "Test water carton", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Correct quantities", exact: true })
    .click();
  await page.getByLabel("Cartons Delivered", { exact: true }).fill("2");
  await language(page, "ne");
  await page
    .getByRole("button", { name: "डेलिभरी समीक्षा", exact: true })
    .click();
  await expect(quantity(jars, "फिर्ता आउन बाँकी जार")).toHaveText("४");
  const cartons = page.getByRole("region", {
    name: "Test water carton",
    exact: true,
  });
  await expect(quantity(cartons, "डेलिभरी भएका कार्टुन")).toHaveText("२");
  await expect(cartons.locator("dt")).toHaveCount(1);
  await language(page, "en");
  await save(page);
  const w = await admin.workspace(trip);
  expect(
    w.custody.find(
      (c) => c.customer_id === customer && c.product_id === fixtureIds.jar,
    )?.quantity,
  ).toBe(14);
  const location = w.vehicles.find(
    (v) => v.id === w.trips[0]!.vehicle_id,
  )!.location_id;
  expect(
    Object.fromEntries(
      w.balances
        .filter((b) => b.location_id === location)
        .map((b) => [b.stock_kind, b.quantity]),
    ),
  ).toMatchObject({ FULL_JAR: 78, EMPTY_JAR: 8, BOTTLE_CARTON: 8 });
  const f = await admin.rpc<FinanceWorkspace>("finance_workspace", {});
  const mixed = f.invoices.find((i) => i.total === "2103.50")!;
  expect(mixed.outstanding).toBe("2103.50");
  const text = await pdfText(page, `/api/invoices/${mixed.id}/pdf`);
  for (const value of [
    "Jars Delivered: 12",
    "Empty Jars Returned: 8",
    "Unreturned Jars: 4",
    "Cartons Delivered: 2",
  ])
    expect(text).toContain(value);
  await page.goto(`/driver/trips/${trip}`);
  await expect(
    page
      .getByRole("region", { name: "Test water carton", exact: true })
      .last()
      .locator("dt"),
  ).toHaveCount(1);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
