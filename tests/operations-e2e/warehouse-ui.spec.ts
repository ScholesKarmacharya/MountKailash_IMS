import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { activeFixtureTrip, fixtureIds } from "./fixture-client";
import type { DayDetail } from "../../src/domain/business-days/types";
import { message } from "../../src/lib/i18n/messages";
import { formatBusinessDate } from "../../src/domain/localization/calendar";

async function language(page: Page, locale: "en" | "ne") {
  const response = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/preferences") && r.request().method() === "POST",
  );
  await page
    .getByRole("button", {
      name: locale === "en" ? "English" : "नेपाली",
      exact: true,
    })
    .click();
  expect((await response).ok()).toBe(true);
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
async function setup(request: Parameters<typeof activeFixtureTrip>[0]) {
  const f = await activeFixtureTrip(request, 67);
  const day = (await f.admin.workspace()).days.find(
    (d) => d.status === "OPEN",
  )!;
  await f.admin.rpc("adjust_warehouse_stock", {
    p_product: fixtureIds.jar,
    p_kind: "EMPTY_JAR",
    p_delta: 50,
    p_reason: "Isolated accepted warehouse empties",
    p_notes: "",
    p_day: day.id,
    p_key: randomUUID(),
  });
  const detail = () =>
    f.admin.rpc<DayDetail>("business_day_report", { p_day: day.id });
  return { ...f, day, detail };
}
async function noOverflow(page: Page) {
  await expect(
    page.locator(
      '[data-testid="inventory-workspace"], [data-testid="processing-workspace"]',
    ),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
}

function hydrationErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (entry) => {
    if (
      entry.type() === "error" &&
      /hydration|cannot be a child|validateDOMNesting/i.test(entry.text())
    )
      errors.push(entry.text());
  });
  return errors;
}

test("warehouse scope, adjustments, immutable details, date filters and independent pagination", async ({
  page,
  request,
}, info) => {
  const f = await setup(request);
  const errors = hydrationErrors(page);
  await f.driver.rpc("post_driver_delivery", {
    p_trip: f.trip,
    p_customer: f.customer,
    p_walk_name: "",
    p_walk_phone: "",
    p_items: [
      { product_id: fixtureIds.jar, full_jars: 2, empty_jars: 1, cartons: 0 },
    ],
    p_status: "PAID",
    p_received: "300.50",
    p_notes: "Original sale note",
    p_key: randomUUID(),
  });
  const original = await f.admin.workspace(f.trip);
  const originalMovements = (await f.detail()).report.movements;
  let decline = true;
  page.on("dialog", (d) =>
    d.type() === "confirm" && decline ? d.dismiss() : d.accept(),
  );
  await login(page);
  await page.goto("/admin/inventory");
  await expect(page.getByTestId("warehouse-FULL_JAR")).toHaveText("33");
  await expect(page.getByTestId("warehouse-EMPTY_JAR")).toHaveText("50");
  await expect(page.getByTestId("warehouse-BOTTLE_CARTON")).toHaveText("10");
  await expect(
    page.getByTestId("warehouse-product-" + fixtureIds.jar),
  ).toContainText("33");
  await expect(
    page.getByTestId("warehouse-product-" + fixtureIds.jar),
  ).toContainText("50");
  const activity = page.getByTestId("stock-activity-history");
  await expect(activity).toContainText("Loaded onto Vehicle");
  await expect(activity).not.toContainText("Delivered to Customer");
  await expect(activity).not.toContainText("Empty Jars Collected");
  await page.getByRole("button", { name: "Adjust Stock", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "Manual adjustment",
    exact: true,
  });
  const form = dialog.locator("form");
  await form
    .getByLabel("Product", { exact: true })
    .selectOption(fixtureIds.jar);
  await form
    .getByLabel("Stock state", { exact: true })
    .selectOption("FULL_JAR");
  await form.getByLabel("Direction", { exact: true }).selectOption("decrease");
  await form.getByLabel("Quantity", { exact: true }).fill("40");
  await expect(
    form.getByRole("button", { name: "Post adjustment", exact: true }),
  ).toBeDisabled();
  await expect(form.getByRole("alert")).toContainText("available stock");
  await form.getByLabel("Quantity", { exact: true }).fill("3");
  await expect(
    form
      .getByTestId("stock-change-preview")
      .getByRole("row", { name: "Full jars 33 30", exact: true }),
  ).toBeVisible();
  await form
    .getByLabel("Adjustment reason", { exact: true })
    .fill("Audited physical stock correction");
  const key = await form.locator('input[name="key"]').inputValue();
  await form
    .getByRole("button", { name: "Post adjustment", exact: true })
    .click();
  expect((await f.detail()).report.movements).toEqual(originalMovements);
  decline = false;
  await form
    .getByRole("button", { name: "Post adjustment", exact: true })
    .click();
  await expect(form.getByRole("status")).toContainText("Adjustment posted.");
  await expect(
    form.getByRole("button", { name: "Post adjustment", exact: true }),
  ).toBeDisabled();
  await form.getByRole("button", { name: "Close", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => document.body.style.overflow))
    .toBe("");
  const scrollBefore = await page.evaluate(() => scrollY);
  await page.mouse.wheel(0, 240);
  await expect
    .poll(() => page.evaluate(() => scrollY))
    .toBeGreaterThan(scrollBefore);
  await expect(page.getByTestId("warehouse-FULL_JAR")).toHaveText("30");
  const posted = await f.admin.workspace(f.trip);
  const postedMovements = (await f.detail()).report.movements;
  expect(postedMovements).toHaveLength(originalMovements.length + 1);
  for (const movement of originalMovements)
    expect(postedMovements.find((m) => m.id === movement.id)).toEqual(movement);
  expect(posted.visits).toEqual(original.visits);
  expect(posted.items).toEqual(original.items);
  const retry = await f.admin.rpc("adjust_warehouse_stock", {
    p_product: fixtureIds.jar,
    p_kind: "FULL_JAR",
    p_delta: -3,
    p_reason: "Audited physical stock correction",
    p_notes: "",
    p_day: f.day.id,
    p_key: key,
  });
  expect((await f.detail()).report.movements).toEqual(postedMovements);
  const audit = page.getByTestId("adjustment-history");
  await expect(audit).toContainText("Audited physical stock correction");
  await expect(audit).toContainText("Fixture admin");
  await expect(audit.getByTestId("adjustment-" + retry)).toContainText(
    "Before: 33",
  );
  await expect(audit.getByTestId("adjustment-" + retry)).toContainText(
    "After: 30",
  );
  await audit
    .getByTestId("adjustment-" + retry)
    .getByText("View Details", { exact: true })
    .click();
  await expect(audit.getByTestId("adjustment-" + retry)).toContainText(key);
  const filters = page.getByTestId("movement-history-filters");
  await filters
    .getByLabel("History Scope", { exact: true })
    .selectOption("company");
  await filters
    .getByLabel("Product", { exact: true })
    .selectOption(fixtureIds.jar);
  await filters
    .getByLabel("Stock state", { exact: true })
    .selectOption("EMPTY_JAR");
  await filters
    .getByLabel("Movement Type", { exact: true })
    .selectOption("EMPTY_COLLECTION");
  await filters
    .getByRole("button", { name: "Filter history", exact: true })
    .click();
  await expect(activity.locator("article")).toHaveCount(1);
  await expect(activity).toContainText("Empty Jars Collected");
  await expect(activity).toContainText("Fixture driver");
  await noOverflow(page);
  await page.getByTestId("inventory-workspace").screenshot({
    path: "test-results/inventory-" + info.project.name + "-en.png",
    scale: "css",
  });
  await language(page, "ne");
  await expect(
    page.getByRole("heading", {
      name: message("ne", "Warehouse inventory"),
      exact: true,
    }),
  ).toBeVisible();
  await expect(activity).toContainText(message("ne", "Empty Jars Collected"));
  await noOverflow(page);
  await page.getByTestId("inventory-workspace").screenshot({
    path: "test-results/inventory-" + info.project.name + "-ne.png",
    scale: "css",
  });
  await language(page, "en");
  await filters
    .getByRole("link", { name: "Reset Filters", exact: true })
    .click();
  await expect(
    filters.getByLabel("History Scope", { exact: true }),
  ).toHaveValue("warehouse");
  await filters
    .getByLabel("Date range", { exact: true })
    .selectOption("yesterday");
  await filters
    .getByRole("button", { name: "Filter history", exact: true })
    .click();
  await expect(activity).toContainText(
    "No Stock Activity Matches These Filters.",
  );
  await expect(page.getByTestId("warehouse-FULL_JAR")).toHaveText("30");
  await expect(page.getByTestId("warehouse-EMPTY_JAR")).toHaveText("50");
  for (let i = 0; i < 26; i++)
    await f.admin.rpc("adjust_warehouse_stock", {
      p_product: fixtureIds.jar,
      p_kind: "EMPTY_JAR",
      p_delta: 1,
      p_reason: "Isolated pagination evidence " + i,
      p_notes: "",
      p_day: f.day.id,
      p_key: randomUUID(),
    });
  await page.goto(
    "/admin/inventory?adjustment_product=" +
      fixtureIds.jar +
      "&adjustment_state=EMPTY_JAR",
  );
  await expect(audit.locator("article")).toHaveCount(25);
  await page
    .getByRole("navigation", { name: "Adjustment history pages", exact: true })
    .getByRole("link", { name: "Older entries", exact: true })
    .click();
  await expect(page).toHaveURL(/adjustment_page=1/);
  await expect(audit.locator("article")).toHaveCount(2);
  await expect(page.getByTestId("warehouse-EMPTY_JAR")).toHaveText("76");
  await expect(audit.getByRole("button", { name: /Edit|Delete/ })).toHaveCount(
    0,
  );
  expect(errors).toEqual([]);
});

test("completed refill and damage previews preserve physical jars and original audit movements", async ({
  page,
  request,
}, info) => {
  const f = await setup(request);
  const errors = hydrationErrors(page);
  page.on("dialog", (d) => d.accept());
  await login(page);
  await page.goto("/admin/refilling");
  const refill = page.getByTestId("processing-form-REFILL");
  const damage = page.getByTestId("processing-form-DAMAGE");
  await refill
    .getByLabel("Jar product", { exact: true })
    .selectOption(fixtureIds.jar);
  await expect(refill.getByTestId("Available Full Jars")).toHaveText("33");
  await expect(refill.getByTestId("Available Empty Jars")).toHaveText("50");
  await expect(refill.getByTestId("Damaged / Quarantined Jars")).toHaveText(
    "0",
  );
  await refill
    .getByLabel("Jars Successfully Refilled", { exact: true })
    .fill("51");
  await expect(
    refill.getByRole("button", {
      name: "Record Completed Refill",
      exact: true,
    }),
  ).toBeDisabled();
  await refill
    .getByLabel("Jars Successfully Refilled", { exact: true })
    .fill("10");
  await expect(
    refill
      .getByTestId("stock-change-preview")
      .getByRole("row", { name: "Full jars 33 43", exact: true }),
  ).toBeVisible();
  await expect(
    refill
      .getByTestId("stock-change-preview")
      .getByRole("row", { name: "Empty jars 50 40", exact: true }),
  ).toBeVisible();
  await refill
    .getByLabel("Processing Reason / Notes", { exact: true })
    .fill("aa");
  await refill
    .getByRole("button", { name: "Record Completed Refill", exact: true })
    .click();
  await expect(refill.getByRole("alert")).toContainText(
    "A specific reason is required.",
  );
  expect((await f.detail()).report.processing).toHaveLength(0);
  const before = await f.admin.workspace(f.trip);
  const beforeMovements = (await f.detail()).report.movements;
  const key = await refill.locator('input[name="key"]').inputValue();
  await refill
    .getByLabel("Processing Reason / Notes", { exact: true })
    .fill("Completed eligible refill batch");
  await refill
    .getByRole("button", { name: "Record Completed Refill", exact: true })
    .click();
  await expect(refill.getByRole("status")).toContainText("Record saved.");
  await expect(refill.getByTestId("stock-change-preview")).toHaveCount(0);
  await expect(refill.getByTestId("Available Full Jars")).toHaveText("43");
  await expect(refill.getByTestId("Available Empty Jars")).toHaveText("40");
  const after = await f.admin.workspace(f.trip);
  const afterMovements = (await f.detail()).report.movements;
  expect(afterMovements).toHaveLength(beforeMovements.length + 2);
  expect(
    after.balances.filter(
      (b) => b.location_id === before.vehicles[0]!.location_id,
    ),
  ).toEqual(
    before.balances.filter(
      (b) => b.location_id === before.vehicles[0]!.location_id,
    ),
  );
  const processingId = await f.admin.rpc<string>("process_warehouse_jars", {
    p_day: f.day.id,
    p_product: fixtureIds.jar,
    p_operation: "REFILL",
    p_kind: "EMPTY_JAR",
    p_quantity: 10,
    p_reason: "Completed eligible refill batch",
    p_key: key,
  });
  expect((await f.detail()).report.movements).toEqual(afterMovements);
  const physical = async () =>
    (await f.detail()).report.stock
      .filter((s) => s.product_id === fixtureIds.jar)
      .reduce((sum, s) => sum + s.closing, 0);
  expect(await physical()).toBe(83);
  await damage
    .getByLabel("Jar product", { exact: true })
    .selectOption(fixtureIds.jar);
  await expect(damage.getByTestId("Available Empty Jars")).toHaveText("40");
  await damage.getByLabel("Damaged jar quantity", { exact: true }).fill("3");
  await damage
    .getByLabel("Inspection Reason / Notes", { exact: true })
    .fill("Three cracked empty jars inspected");
  await expect(
    damage
      .getByTestId("stock-change-preview")
      .getByRole("row", { name: "Available Empty Jars 40 37", exact: true }),
  ).toBeVisible();
  await damage
    .getByRole("button", { name: "Record Damaged Jars", exact: true })
    .click();
  await expect(damage.getByRole("status")).toContainText("Record saved.");
  expect(await physical()).toBe(83);
  await page.reload();
  await damage
    .getByLabel("Jar product", { exact: true })
    .selectOption(fixtureIds.jar);
  await damage
    .getByLabel("Damaged jar state", { exact: true })
    .selectOption("FULL_JAR");
  await damage.getByLabel("Damaged jar quantity", { exact: true }).fill("2");
  await damage
    .getByLabel("Inspection Reason / Notes", { exact: true })
    .fill("Two cracked full jars inspected");
  await damage
    .getByRole("button", { name: "Record Damaged Jars", exact: true })
    .click();
  await expect(damage.getByRole("status")).toContainText("Record saved.");
  expect(await physical()).toBe(83);
  await page.reload();
  await refill
    .getByLabel("Jar product", { exact: true })
    .selectOption(fixtureIds.jar);
  await expect(refill.getByTestId("Available Full Jars")).toHaveText("41");
  await expect(refill.getByTestId("Available Empty Jars")).toHaveText("37");
  await expect(refill.getByTestId("Damaged / Quarantined Jars")).toHaveText(
    "5",
  );
  await expect(refill.getByTestId("Available for Refilling")).toHaveText("37");
  const history = page.getByTestId("processing-history");
  await expect(history.locator("article")).toHaveCount(3);
  const record = page.getByTestId("processing-" + processingId);
  await expect(record).toContainText("Completed Refill");
  await expect(record).toContainText(formatBusinessDate(f.day.date_label));
  await record.getByText("View Details", { exact: true }).click();
  const movements = afterMovements.filter(
    (m) => m.processing_id === processingId,
  );
  expect(movements).toHaveLength(2);
  for (const movement of movements)
    await expect(record).toContainText(movement.id);
  await record.getByText("View Details", { exact: true }).click();
  await noOverflow(page);
  await page.getByTestId("processing-workspace").screenshot({
    path: "test-results/processing-" + info.project.name + "-en.png",
    scale: "css",
  });
  await language(page, "ne");
  await expect(
    page.getByRole("heading", {
      name: message("ne", "Refilling and damaged jars"),
      exact: true,
    }),
  ).toBeVisible();
  await noOverflow(page);
  await page.getByTestId("processing-workspace").screenshot({
    path: "test-results/processing-" + info.project.name + "-ne.png",
    scale: "css",
  });
  await language(page, "en");
  await page.goto("/admin/inventory?type=REFILL_OUTPUT");
  const activity = page.getByTestId("stock-activity-history");
  await expect(activity.locator("article")).toHaveCount(1);
  await expect(activity).toContainText("Completed Refill");
  await activity.getByText("View Details", { exact: true }).click();
  for (const movement of movements)
    await expect(activity).toContainText(movement.id);
  await page.goto("/admin/refilling");
  const filters = page.getByTestId("processing-history-filters");
  await filters
    .getByLabel("Date range", { exact: true })
    .selectOption("yesterday");
  await filters
    .getByRole("button", { name: "Filter history", exact: true })
    .click();
  await expect(history).toContainText("No processing matches these dates.");
  await refill
    .getByLabel("Jar product", { exact: true })
    .selectOption(fixtureIds.jar);
  await expect(refill.getByTestId("Available for Refilling")).toHaveText("37");
  expect(errors).toEqual([]);
});
