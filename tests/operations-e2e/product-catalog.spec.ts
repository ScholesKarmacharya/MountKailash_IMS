import { test, expect, type Page, type Locator } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { activeFixtureTrip, fixtureIds } from "./fixture-client";
import type { HouseWorkspace } from "../../src/domain/house/types";
import type { FinanceWorkspace } from "../../src/domain/finance/types";
import { formatBusinessDate } from "../../src/domain/localization/calendar";

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
async function login(page: Page) {
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "English", exact: true }).click();
  await page.getByLabel("Email address").fill("admin@fixture.example");
  await page.getByLabel("Password", { exact: true }).fill("fixture-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/admin/dashboard");
  await language(page, "en");
}
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
}
async function fillProduct(
  dialog: Locator,
  sku: string,
  name = "Local custom carton",
) {
  await dialog.getByLabel("Product name", { exact: true }).fill(name);
  await dialog.getByLabel("SKU", { exact: true }).fill(sku);
  await dialog
    .getByLabel("Default selling price (NPR)", { exact: true })
    .fill("185.75");
}
async function pdfText(page: Page, href: string) {
  const response = await page.request.get(href);
  expect(response.ok()).toBe(true);
  expect(response.headers()["content-type"]).toContain("application/pdf");
  const bytes = await response.body();
  expect(bytes.subarray(0, 4).toString()).toBe("%PDF");
  const task = getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: false,
  });
  const pdf = await task.promise;
  const text: string[] = [];
  for (let p = 1; p <= pdf.numPages; p++)
    text.push(
      (await (await pdf.getPage(p)).getTextContent()).items
        .map((i) => ("str" in i ? i.str : ""))
        .join(" "),
    );
  await task.destroy();
  return text.join(" ");
}

test("catalog creation, safe editing, duplicate SKU, keyboard dialogs and bilingual layouts", async ({
  page,
  request,
}, testInfo) => {
  const f = await activeFixtureTrip(request, 20, 5);
  const original = await f.admin.workspace(f.trip);
  page.on("dialog", (d) => d.accept());
  await login(page);
  await page.goto("/admin/products");
  const catalog = page.getByTestId("products-catalog");
  await expect(catalog.locator('[data-testid^="product-card-"]')).toHaveCount(
    2,
  );
  const jar = page.getByTestId("product-card-" + fixtureIds.jar);
  const carton = page.getByTestId(
    "product-card-00000000-0000-0000-0000-000000000012",
  );
  await expect(jar).toContainText("20L returnable water jar");
  await expect(jar.getByTestId("product-default-price")).toHaveText(
    "NPR 150.25 / " +
      original.products.find((p) => p.id === fixtureIds.jar)!.unit,
  );
  await expect(carton).toContainText("Bottled-water carton");
  await expect(carton.getByTestId("product-default-price")).toHaveText(
    "NPR 150.25 / " +
      original.products.find(
        (p) => p.id === "00000000-0000-0000-0000-000000000012",
      )!.unit,
  );
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await noOverflow(page);
  const add = page.getByRole("button", { name: "Add Product", exact: true });
  await add.click();
  let dialog = page.getByRole("dialog", { name: "Add Product", exact: true });
  await expect(
    dialog.getByLabel("Product name", { exact: true }),
  ).toBeFocused();
  for (let i = 0; i < 14; i++) {
    await page.keyboard.press("Tab");
    expect(
      await dialog.evaluate((el) => el.contains(document.activeElement)),
    ).toBe(true);
  }
  for (let i = 0; i < 14; i++) {
    await page.keyboard.press("Shift+Tab");
    expect(
      await dialog.evaluate((el) => el.contains(document.activeElement)),
    ).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(add).toBeFocused();
  await add.click();
  dialog = page.getByRole("dialog", { name: "Add Product", exact: true });
  await expect(dialog.getByLabel("Unit", { exact: true })).toHaveValue("jar");
  await dialog
    .getByLabel("Product kind", { exact: true })
    .selectOption("BOTTLE_CARTON");
  await expect(dialog.getByLabel("Unit", { exact: true })).toHaveValue(
    "carton",
  );
  await dialog.getByLabel("Unit", { exact: true }).fill("crate");
  await dialog
    .getByLabel("Product kind", { exact: true })
    .selectOption("FULL_JAR");
  await expect(dialog.getByLabel("Unit", { exact: true })).toHaveValue("crate");
  await dialog
    .getByLabel("Product kind", { exact: true })
    .selectOption("BOTTLE_CARTON");
  await fillProduct(dialog, "local-crate");
  await expect(dialog.getByTestId("product-price-preview")).toContainText(
    "NPR 185.75 / crate",
  );
  await dialog
    .getByRole("button", { name: "Save Product", exact: true })
    .click();
  await expect(
    dialog.getByLabel("Reason for catalog change", { exact: true }),
  ).toBeFocused();
  expect((await f.admin.workspace()).products).toHaveLength(2);
  await dialog
    .getByLabel("Reason for catalog change", { exact: true })
    .fill("Reviewed custom carton catalog");
  await dialog
    .getByRole("button", { name: "Save Product", exact: true })
    .click();
  await expect(dialog.getByRole("status")).toContainText("Product saved.");
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  const created = (await f.admin.workspace()).products.find(
    (p) => p.sku === "LOCAL-CRATE",
  )!;
  expect(created).toMatchObject({
    kind: "BOTTLE_CARTON",
    unit: "crate",
    default_price: "185.75",
    is_active: true,
  });
  await expect(catalog.locator('[data-testid^="product-card-"]')).toHaveCount(
    3,
  );
  await add.click();
  dialog = page.getByRole("dialog", { name: "Add Product", exact: true });
  await fillProduct(dialog, "JAR", "Duplicate must not replace original");
  await dialog
    .getByLabel("Reason for catalog change", { exact: true })
    .fill("Isolated duplicate validation");
  await dialog
    .getByRole("button", { name: "Save Product", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  expect((await f.admin.workspace()).products).toHaveLength(3);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  const custom = page.getByTestId("product-card-" + created.id);
  await custom
    .getByRole("button", { name: "Edit Product", exact: true })
    .click();
  dialog = page.getByRole("dialog", { name: "Edit Product", exact: true });
  await expect(dialog.getByLabel("SKU", { exact: true })).toHaveAttribute(
    "readonly",
    "",
  );
  await expect(dialog.getByLabel("Unit", { exact: true })).toHaveAttribute(
    "readonly",
    "",
  );
  await expect(dialog.locator('select[name="kind"]')).toHaveCount(0);
  await dialog
    .getByLabel("Product name", { exact: true })
    .fill("Local custom carton updated");
  await dialog
    .getByLabel("Default selling price (NPR)", { exact: true })
    .fill("190.45");
  await dialog.getByLabel("Status", { exact: true }).selectOption("false");
  await dialog
    .getByLabel("Reason for catalog change", { exact: true })
    .fill("Audited price and status update");
  await dialog
    .getByRole("button", { name: "Save Product", exact: true })
    .click();
  await expect(dialog.getByRole("status")).toContainText("Product saved.");
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(custom).toContainText("Inactive");
  await expect(custom.getByTestId("product-default-price")).toHaveText(
    "NPR 190.45 / crate",
  );
  const after = await f.admin.workspace(f.trip);
  expect(after.balances.filter((b) => b.product_id !== created.id)).toEqual(
    original.balances,
  );
  expect(
    after.balances
      .filter((b) => b.product_id === created.id)
      .every((b) => b.quantity === 0),
  ).toBe(true);
  expect(after.visits).toEqual(original.visits);
  expect(after.items).toEqual(original.items);
  expect(after.movements).toEqual(original.movements);
  await catalog.screenshot({
    path: "test-results/catalog-" + testInfo.project.name + "-en.png",
    scale: "css",
  });
  await language(page, "ne");
  await expect(
    page.getByRole("heading", { name: "उत्पादनहरू", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "उत्पादन थप्नुहोस्", exact: true }),
  ).toBeVisible();
  await noOverflow(page);
  await catalog.screenshot({
    path: "test-results/catalog-" + testInfo.project.name + "-ne.png",
    scale: "css",
  });
  await page
    .getByRole("button", { name: "उत्पादन थप्नुहोस्", exact: true })
    .click();
  dialog = page.getByRole("dialog", { name: "उत्पादन थप्नुहोस्", exact: true });
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate((el) => el.scrollTop)).toBe(0);
  await expect(dialog.locator('input[name="name"]')).toBeInViewport();
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
    true,
  );
  await page.screenshot({
    path: "test-results/catalog-dialog-" + testInfo.project.name + "-ne.png",
    scale: "css",
  });
  await page.keyboard.press("Escape");
  await language(page, "en");
  await page.goto("/admin/pricing");
  await expect(
    page.getByTestId("pricing-product-" + created.id).filter({ visible: true }),
  ).toContainText("NPR 190.45");
  await expect(page.getByTestId("free-delivery-history")).toContainText(
    "No free deliveries in this range.",
  );
  await expect(page.getByTestId("house-customers")).toContainText(
    "No HOUSE customers yet.",
  );
});

test("pricing, HOUSE reports, BS filters, exports and audited corrections preserve transactions", async ({
  page,
  request,
}, testInfo) => {
  const f = await activeFixtureTrip(request, 50, 10);
  const alpha = randomUUID(),
    beta = randomUUID();
  for (const [id, name] of [
    [alpha, "Alpha House"],
    [beta, "Beta House"],
  ])
    await f.admin.rpc("save_house_customer", {
      p_id: id,
      p_name: name,
      p_shop: "",
      p_phone: "9800000000",
      p_address: "Kathmandu",
      p_notes: "",
      p_active: true,
      p_version: 0,
      p_reason: "Approved isolated family supply",
      p_key: randomUUID(),
      p_contact_person: "Family",
      p_supply_type: "HOUSE",
      p_house_status: "APPROVED",
    });
  for (const [customer, jars, empties, status, received] of [
    [f.customer, 2, 0, "PAID", "300.50"],
    [alpha, 15, 10, "FREE_SUPPLY", null],
    [beta, 2, 0, "FREE_SUPPLY", null],
  ] as const)
    await f.driver.rpc("post_driver_delivery", {
      p_trip: f.trip,
      p_customer: customer,
      p_walk_name: "",
      p_walk_phone: "",
      p_items: [
        {
          product_id: fixtureIds.jar,
          full_jars: jars,
          empty_jars: empties,
          cartons: 0,
        },
      ],
      p_status: status,
      p_received: received,
      p_notes: "Historical test note preserved",
      p_key: randomUUID(),
    });
  const report = () =>
    f.admin.rpc<HouseWorkspace>("house_workspace", {
      p_start: "2000-01-01",
      p_end: "2100-01-01",
      p_customer: null,
      p_driver: null,
      p_product: null,
    });
  const original = await f.admin.workspace(f.trip),
    history = await report(),
    finance = await f.admin.rpc<FinanceWorkspace>("finance_workspace", {});
  expect(history.rows).toHaveLength(2);
  expect(finance.invoices.map((i) => i.total).sort()).toEqual([
    "0.00",
    "0.00",
    "300.50",
  ]);
  page.on("dialog", (d) => d.accept());
  await login(page);
  await page.goto("/admin/pricing");
  const pricing = page.getByTestId("pricing-free-supply");
  await expect(page.getByTestId("Total Free Jars")).toHaveText("17");
  await expect(page.getByTestId("Total Free Cartons")).toHaveText("0");
  await expect(page.getByTestId("Value of Free Supply")).toHaveText(
    "NPR 2,554.25",
  );
  const customers = page.getByTestId("house-customers");
  await expect(
    customers
      .getByRole("link", { name: "Alpha House", exact: true })
      .filter({ visible: true }),
  ).toHaveAttribute("href", "/admin/customers/" + alpha);
  await expect(customers).toContainText("9800000000");
  await expect(customers).toContainText("Kathmandu");
  const corrections = page.getByTestId("free-supply-corrections");
  await expect(corrections).not.toHaveAttribute("open");
  const summaryBox = await page
      .getByTestId("free-supply-overview")
      .boundingBox(),
    filterBox = await page.getByTestId("free-supply-filters").boundingBox();
  expect(summaryBox!.y + summaryBox!.height).toBeLessThan(filterBox!.y);
  const jarRow = page
    .getByTestId("pricing-product-" + fixtureIds.jar)
    .filter({ visible: true });
  await expect(jarRow).toContainText("Eligible");
  await jarRow.getByRole("button", { name: "Edit", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "Edit Pricing",
    exact: true,
  });
  await expect(
    dialog.getByLabel("Default selling price (NPR)", { exact: true }),
  ).toBeFocused();
  await dialog
    .getByLabel("Default selling price (NPR)", { exact: true })
    .fill("200.00");
  await dialog
    .getByLabel("Reference Price (NPR)", { exact: true })
    .fill("100.00");
  await dialog
    .getByLabel("Reason for this change", { exact: true })
    .fill("Audited future pricing update");
  await dialog
    .getByRole("button", { name: "Save pricing", exact: true })
    .click();
  await expect(dialog.getByRole("status")).toContainText("Record saved.");
  await dialog
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await expect(jarRow).toContainText("NPR 200.00");
  await expect(jarRow).toContainText("NPR 100.00");
  const updated = await f.admin.workspace(f.trip);
  expect(
    updated.products.find((p) => p.id === fixtureIds.jar)?.house_eligible,
  ).toBe(true);
  expect(updated.balances).toEqual(original.balances);
  expect(updated.visits).toEqual(original.visits);
  expect(updated.items).toEqual(original.items);
  expect(updated.movements).toEqual(original.movements);
  expect((await report()).rows).toEqual(history.rows);
  const afterFinance = await f.admin.rpc<FinanceWorkspace>(
    "finance_workspace",
    {},
  );
  expect(afterFinance.invoices).toEqual(finance.invoices);
  expect(afterFinance.items).toEqual(finance.items);
  expect(afterFinance.payments).toEqual(finance.payments);
  await page.goto("/admin/products");
  await expect(
    page
      .getByTestId("product-card-" + fixtureIds.jar)
      .getByTestId("product-default-price"),
  ).toHaveText(
    "NPR 200.00 / " +
      original.products.find((p) => p.id === fixtureIds.jar)!.unit,
  );
  await page.goto("/admin/pricing");
  const filters = page.getByTestId("free-supply-filters");
  await filters
    .getByLabel("Date range", { exact: true })
    .selectOption("custom");
  for (const name of ["From BS date", "To BS date"]) {
    await filters.getByRole("button", { name, exact: true }).click();
    await page
      .getByRole("dialog", { name: "BS calendar", exact: true })
      .getByRole("button", { name: "Today", exact: true })
      .click();
  }
  await filters.getByLabel("Customer", { exact: true }).selectOption(alpha);
  await filters
    .getByLabel("Driver", { exact: true })
    .selectOption(fixtureIds.driver);
  await filters
    .getByLabel("Product", { exact: true })
    .selectOption(fixtureIds.jar);
  await filters.getByRole("button", { name: "Filter", exact: true }).click();
  await expect(page).toHaveURL(new RegExp("customer=" + alpha));
  await expect(page.getByTestId("Total Free Jars")).toHaveText("15");
  await expect(page.getByTestId("Value of Free Supply")).toHaveText(
    "NPR 2,253.75",
  );
  const freeHistory = page.getByTestId("free-delivery-history");
  await expect(freeHistory).not.toContainText("Beta House");
  await expect(freeHistory).toContainText("Alpha House");
  await expect(freeHistory).toContainText("NPR 150.25");
  const alphaRow = history.rows.find((r) => r.customer_id === alpha)!;
  const mobileDetails = page.getByTestId(
    "free-delivery-" + alphaRow.visit_id + "-" + fixtureIds.jar,
  );
  if (page.viewportSize()!.width < 1280) {
    await expect(mobileDetails).toBeVisible();
    await mobileDetails.locator("summary").click();
    await expect(mobileDetails).toHaveAttribute("open");
    await expect(mobileDetails).toContainText(alphaRow.visit_id);
    await expect(mobileDetails).toContainText("Empty Jars Returned10");
  }
  await expect(
    freeHistory
      .getByRole("link", { name: "Trip #" + alphaRow.trip_number, exact: true })
      .filter({ visible: true }),
  ).toHaveAttribute("href", "/admin/trips/" + f.trip);
  await expect(freeHistory).toContainText(
    formatBusinessDate(alphaRow.occurred_at, "en", true),
  );
  const pdfHref = (await filters
    .getByRole("link", { name: "Download PDF", exact: true })
    .getAttribute("href"))!;
  const exportUrl = new URL(pdfHref, "http://127.0.0.1:3002"),
    current = new URL(page.url());
  for (const name of ["from", "to", "customer", "driver", "product"])
    expect(exportUrl.searchParams.get(name)).toBe(
      current.searchParams.get(name),
    );
  expect(exportUrl.searchParams.get("preset")).toBe("custom");
  const exported = await pdfText(page, pdfHref);
  expect(exported).toContain("Alpha House");
  expect(exported).not.toContain("Beta House");
  expect(exported).toContain("2253.75");
  const excelHref = (await filters
    .getByRole("link", { name: "Download Excel", exact: true })
    .getAttribute("href"))!;
  const excel = await page.request.get(excelHref);
  expect(excel.ok()).toBe(true);
  const workbook = await excel.body();
  expect(workbook.readUInt32LE()).toBe(0x04034b50);
  expect(workbook.toString()).toContain(alphaRow.visit_id);
  expect(workbook.toString()).toContain("2253.75");
  expect(workbook.toString()).not.toContain("Beta House");
  await noOverflow(page);
  await pricing.screenshot({
    path: "test-results/pricing-" + testInfo.project.name + "-en.png",
    scale: "css",
  });
  await language(page, "ne");
  await expect(
    page.getByRole("heading", {
      name: "मूल्य निर्धारण र निःशुल्क वितरण",
      exact: true,
    }),
  ).toBeVisible();
  await expect(pricing).toContainText(
    formatBusinessDate(alphaRow.occurred_at, "ne", true),
  );
  await noOverflow(page);
  await pricing.screenshot({
    path: "test-results/pricing-" + testInfo.project.name + "-ne.png",
    scale: "css",
  });
  await language(page, "en");
  await corrections.locator("summary").first().click();
  await corrections
    .getByText("Post adjustment", { exact: true })
    .first()
    .click();
  const correctionForm = corrections.locator("form");
  await correctionForm
    .getByLabel("Adjustment type", { exact: true })
    .selectOption("DECREASE");
  await correctionForm
    .getByLabel("Reference value adjustment (NPR)", { exact: true })
    .fill("5.00");
  await correctionForm
    .getByRole("button", { name: "Post adjustment", exact: true })
    .click();
  await expect(
    correctionForm.getByLabel("Reason for correction", { exact: true }),
  ).toBeFocused();
  expect((await report()).adjustments).toHaveLength(0);
  await correctionForm
    .getByLabel("Reason for correction", { exact: true })
    .fill("Separate audited reference correction");
  await correctionForm
    .getByRole("button", { name: "Post adjustment", exact: true })
    .click();
  await expect(correctionForm.getByRole("status")).toContainText(
    "Record saved.",
  );
  const corrected = await report();
  expect(corrected.rows).toEqual(history.rows);
  expect(corrected.adjustments).toHaveLength(1);
  expect(corrected.adjustments[0]).toMatchObject({
    visit_id: alphaRow.visit_id,
    amount: "-5.00",
    reason: "Separate audited reference correction",
  });
  await expect(corrections).toContainText(alphaRow.visit_id);
  await expect(page.getByTestId("Value of Free Supply")).toHaveText(
    "NPR 2,253.75",
  );
  await filters
    .getByRole("link", { name: "Reset Filters", exact: true })
    .click();
  await expect(page).toHaveURL(/\/admin\/pricing$/);
  await expect(filters.getByLabel("Customer", { exact: true })).toHaveValue("");
  await expect(filters.getByLabel("Date range", { exact: true })).toHaveValue(
    "month",
  );
  await expect(page.getByTestId("Total Free Jars")).toHaveText("17");
  await expect(corrections).not.toHaveAttribute("open");
});
