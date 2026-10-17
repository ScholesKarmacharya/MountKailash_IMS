import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { fixtureClient, fixtureIds } from "./fixture-client";

async function login(page: Page, role = "admin") {
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "English", exact: true }).click();
  await page.getByLabel("Email address").fill(`${role}@fixture.example`);
  await page.getByLabel("Password", { exact: true }).fill("fixture-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(
    role === "admin" ? /admin\/dashboard/ : /driver\/home/,
  );
  await page.getByRole("button", { name: "English", exact: true }).click();
  page.on("dialog", (dialog) => dialog.accept());
}
async function seed(request: Parameters<typeof fixtureClient>[0]) {
  expect((await request.post("http://127.0.0.1:17777/reset")).ok()).toBe(true);
  const admin = await fixtureClient(request);
  const vehicle = randomUUID();
  await admin.rpc("save_vehicle", {
    p_id: vehicle,
    p_plate: "LOAD-21450",
    p_description: "",
    p_active: true,
    p_version: 0,
    p_reason: "Isolated one-screen loading test",
    p_key: randomUUID(),
  });
  const w = await admin.workspace();
  const warehouse = w.locations.find((l) => l.code === "MAIN")!.id;
  return {
    admin,
    vehicle,
    day: w.days.find((d) => d.status === "OPEN")!,
    warehouse,
  };
}
async function openForm(page: Page) {
  await login(page);
  await page.goto("/admin/trips");
  const form = page.getByTestId("create-trip-section");
  await expect(
    form.getByRole("button", { name: "Create & Confirm Load", exact: true }),
  ).toBeDisabled();
  await form
    .getByLabel("Driver", { exact: true })
    .selectOption({ label: "Fixture driver" });
  await form
    .getByLabel("Vehicle", { exact: true })
    .selectOption({ label: "LOAD-21450" });
  return form;
}
const warehouseJars = (
  w: Awaited<
    ReturnType<Awaited<ReturnType<typeof fixtureClient>>["workspace"]>
  >,
  warehouse: string,
) =>
  w.balances.find(
    (b) =>
      b.location_id === warehouse &&
      b.product_id === fixtureIds.jar &&
      b.stock_kind === "FULL_JAR",
  )?.quantity;

test("draft quantities keep warehouse stock untouched and can be edited and confirmed later", async ({
  page,
  request,
}) => {
  const { admin, warehouse } = await seed(request);
  const form = await openForm(page);
  await form.getByLabel("20L test jar load", { exact: true }).fill("30");
  await form.getByLabel("Test water carton load", { exact: true }).fill("2");
  await form
    .getByLabel("Trip notes (optional)")
    .fill("Optional physical loading note");
  await form
    .getByRole("button", { name: "Save as Draft", exact: true })
    .click();
  await expect(page.getByTestId("trip-creation-success")).toContainText(
    /saved as a draft/,
  );
  const w = await admin.workspace();
  const trip = w.trips[0]!;
  expect(trip.status).toBe("DRAFT");
  expect(
    trip.proposed_load_items?.find((i) => i.product_id === fixtureIds.jar)
      ?.quantity,
  ).toBe(30);
  expect(warehouseJars(w, warehouse)).toBe(100);
  expect((await admin.workspace(trip.id)).loads).toEqual([]);
  await expect(page.getByTestId(`trip-card-${trip.id}`)).toBeVisible();
  await page.getByRole("link", { name: "Open Trip", exact: true }).click();
  await expect(
    page.getByLabel("20L test jar load", { exact: true }),
  ).toHaveValue("30");
  await page.getByLabel("20L test jar load", { exact: true }).fill("40");
  await page
    .getByRole("button", { name: "Save proposed quantities", exact: true })
    .click();
  await expect(page.getByText("Record saved.", { exact: true })).toBeVisible();
  expect(warehouseJars(await admin.workspace(), warehouse)).toBe(100);
  await page.reload();
  await expect(
    page.getByLabel("20L test jar load", { exact: true }),
  ).toHaveValue("40");
  await page
    .getByRole("button", { name: "Confirm warehouse loading", exact: true })
    .click();
  await expect(page.getByText(/^Physical loading confirmed/)).toBeVisible();
  expect((await admin.workspace(trip.id)).trips[0]?.status).toBe("LOADED");
  expect(warehouseJars(await admin.workspace(), warehouse)).toBe(60);
});

test("one-screen loading supports every active product, refreshes the list and gives the driver a Start Trip action", async ({
  page,
  request,
  browser,
}, info) => {
  test.setTimeout(180000);
  const { admin, warehouse } = await seed(request);
  const extra = randomUUID();
  await admin.rpc("save_product", {
    p_id: extra,
    p_sku: "EXTRA-JAR",
    p_name: "Additional jar product",
    p_kind: "FULL_JAR",
    p_unit: "jar",
    p_price: "90",
    p_active: true,
    p_version: 0,
    p_reason: "Multiple loadable products",
    p_key: randomUUID(),
  });
  const day = (await admin.workspace()).days.find((d) => d.status === "OPEN")!;
  await admin.rpc("adjust_warehouse_stock", {
    p_product: extra,
    p_kind: "FULL_JAR",
    p_delta: 15,
    p_reason: "Additional real fixture stock",
    p_notes: "",
    p_day: day.id,
    p_key: randomUUID(),
  });
  const form = await openForm(page);
  await expect(
    form.getByRole("button", { name: "Create & Confirm Load", exact: true }),
  ).toBeDisabled();
  await expect(
    form.getByRole("button", { name: "Save as Draft", exact: true }),
  ).toBeEnabled();
  const jar = form.getByLabel("20L test jar load", { exact: true });
  await jar.fill("500");
  await expect(jar).toHaveValue("100");
  await jar.fill("50");
  await form
    .getByRole("button", { name: "Increase 20L test jar load", exact: true })
    .click();
  await expect(jar).toHaveValue("51");
  await form
    .getByRole("button", { name: "Decrease 20L test jar load", exact: true })
    .click();
  await form.getByLabel("Test water carton load", { exact: true }).fill("3");
  await form
    .getByLabel("Additional jar product load", { exact: true })
    .fill("5");
  expect(warehouseJars(await admin.workspace(), warehouse)).toBe(100);
  for (const width of [360, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await form
      .getByRole("button", { name: "Create & Confirm Load", exact: true })
      .scrollIntoViewIfNeeded();
    await expect(
      form.getByRole("button", { name: "Create & Confirm Load", exact: true }),
    ).toBeInViewport();
  }
  await page.setViewportSize(
    info.project.name.startsWith("mobile")
      ? { width: 393, height: 851 }
      : { width: 1280, height: 900 },
  );
  mkdirSync("test-results/admin-trip-loading", { recursive: true });
  await page.screenshot({
    path: `test-results/admin-trip-loading/${info.project.name}-form.png`,
    fullPage: true,
  });
  // A second synchronous submit is ignored immediately, before React's pending render.
  await form.locator("form").evaluate((element) => {
    const f = element as HTMLFormElement;
    const button = f.querySelector<HTMLButtonElement>(
      'button[value="CONFIRM"]',
    )!;
    f.requestSubmit(button);
    f.requestSubmit(button);
  });
  const success = page.getByTestId("trip-creation-success");
  await expect(success).toContainText(/created and loaded successfully/);
  await expect(success).toContainText("Ready to Start");
  await expect(success).toContainText("Additional jar product: 5");
  const w = await admin.workspace();
  expect(w.trips).toHaveLength(1);
  const trip = w.trips[0]!;
  expect(trip.status).toBe("LOADED");
  expect(
    (await admin.workspace(trip.id)).movements.filter(
      (m) => m.movement_type === "TRIP_LOAD",
    ),
  ).toHaveLength(3);
  expect(warehouseJars(w, warehouse)).toBe(50);
  await expect(page.getByTestId(`trip-card-${trip.id}`)).toContainText(
    "Prepared / Loaded",
  );
  const context = await browser.newContext({
    viewport: { width: 393, height: 851 },
  });
  try {
    const driver = await context.newPage();
    await login(driver, "driver");
    await expect(
      driver.getByRole("button", { name: "Start Trip", exact: true }),
    ).toBeEnabled();
    await expect(
      driver.getByText("Offline ready", { exact: true }).first(),
    ).toBeVisible({ timeout: 30000 });
    await driver
      .getByRole("button", { name: "Start Trip", exact: true })
      .click();
    await expect(
      driver.getByRole("link", { name: "New Delivery", exact: true }).first(),
    ).toBeVisible();
    expect((await admin.workspace(trip.id)).trips[0]?.status).toBe("ACTIVE");
    expect(
      (await admin.workspace(trip.id)).movements.filter(
        (m) => m.movement_type === "TRIP_LOAD",
      ),
    ).toHaveLength(3);
  } finally {
    await context.close();
  }
});

test("stock changes reject the whole submission and refresh availability while preserving entered fields", async ({
  page,
  request,
}) => {
  const { admin, day, warehouse } = await seed(request);
  const form = await openForm(page);
  await form.getByLabel("20L test jar load", { exact: true }).fill("80");
  await form.getByLabel("Test water carton load", { exact: true }).fill("2");
  await form.getByLabel("Trip notes (optional)").fill("Keep this unsaved note");
  const key = await form.locator('input[name="key"]').inputValue();
  await admin.rpc("adjust_warehouse_stock", {
    p_product: fixtureIds.jar,
    p_kind: "FULL_JAR",
    p_delta: -28,
    p_reason: "Stock changed during form entry",
    p_notes: "",
    p_day: day.id,
    p_key: randomUUID(),
  });
  await form
    .getByRole("button", { name: "Create & Confirm Load", exact: true })
    .click();
  await expect(form.getByRole("alert").last()).toContainText(
    "Requested 80 20L test jar, but only 72 are now available.",
  );
  await expect(
    form.getByTestId(`load-product-${fixtureIds.jar}`),
  ).toContainText("Warehouse available: 72");
  await expect(
    form.getByLabel("20L test jar load", { exact: true }),
  ).toHaveValue("80");
  await expect(form.getByLabel("Trip notes (optional)")).toHaveValue(
    "Keep this unsaved note",
  );
  await expect(form.locator('input[name="key"]')).toHaveValue(key);
  const rejected = await admin.workspace();
  expect(rejected.trips).toEqual([]);
  expect(warehouseJars(rejected, warehouse)).toBe(72);
  await expect(
    form.getByRole("button", { name: "Create & Confirm Load", exact: true }),
  ).toBeDisabled();
  await form.getByLabel("20L test jar load", { exact: true }).fill("72");
  await form
    .getByRole("button", { name: "Create & Confirm Load", exact: true })
    .click();
  await expect(page.getByTestId("trip-creation-success")).toContainText(
    /loaded successfully/,
  );
  expect(warehouseJars(await admin.workspace(), warehouse)).toBe(0);
});

test("a lost success response can be retried with the same identity without another trip or stock deduction", async ({
  page,
  request,
}) => {
  const { admin, warehouse } = await seed(request);
  const form = await openForm(page);
  await form.getByLabel("20L test jar load", { exact: true }).fill("10");
  const key = await form.locator('input[name="key"]').inputValue();
  let loseResponse = true;
  await page.route("**/admin/trips", async (route) => {
    if (
      loseResponse &&
      route.request().method() === "POST" &&
      route.request().headers()["next-action"]
    ) {
      loseResponse = false;
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  await form
    .getByRole("button", { name: "Create & Confirm Load", exact: true })
    .click();
  await expect(form.getByRole("alert")).toContainText(
    "Connection interrupted.",
  );
  await expect(form.locator('input[name="key"]')).toHaveValue(key);
  expect((await admin.workspace()).trips).toHaveLength(1);
  await form
    .getByRole("button", { name: "Create & Confirm Load", exact: true })
    .click();
  await expect(page.getByTestId("trip-creation-success")).toContainText(
    /loaded successfully/,
  );
  const w = await admin.workspace();
  expect(w.trips).toHaveLength(1);
  expect(warehouseJars(w, warehouse)).toBe(90);
  expect(
    (await admin.workspace(w.trips[0]!.id)).movements.filter(
      (m) => m.movement_type === "TRIP_LOAD",
    ),
  ).toHaveLength(1);
});
