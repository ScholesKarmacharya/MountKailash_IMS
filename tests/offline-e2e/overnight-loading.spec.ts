import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { fixtureClient, fixtureIds } from "../operations-e2e/fixture-client";
import { shiftDate } from "../../src/domain/localization/calendar";
import type { DayDetail } from "../../src/domain/business-days/types";
const provider = "http://127.0.0.1:17778";
async function en(page: Page) {
  await page.getByRole("button", { name: "English", exact: true }).click();
}
async function login(page: Page) {
  await page.goto("/sign-in");
  await en(page);
  await page.getByLabel("Email address").fill("other@fixture.example");
  await page.getByLabel("Password", { exact: true }).fill("fixture-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/driver\/home/);
  await en(page);
}
async function nav(page: Page, label: string) {
  await page
    .getByRole("navigation")
    .getByRole("link", { name: label, exact: true })
    .click();
}
test("a next-day night load survives offline reopening and reconnects exactly once with the original allocation", async ({
  page,
  request,
  context,
}) => {
  page.on("dialog", (d) => d.accept());
  await request.post(`${provider}/reset`);
  const admin = await fixtureClient(request),
    driverA = await fixtureClient(request, "driver"),
    driverB = await fixtureClient(request, "other");
  const current = (await admin.workspace()).days[0]!,
    tomorrow = shiftDate(current.date_label, 1);
  await admin.rpc("adjust_warehouse_stock", {
    p_product: fixtureIds.jar,
    p_kind: "FULL_JAR",
    p_delta: 70,
    p_reason: "Isolated overnight scenario",
    p_notes: "",
    p_day: current.id,
    p_key: randomUUID(),
  });
  const trips = [randomUUID(), randomUUID()],
    vehicles = [randomUUID(), randomUUID()],
    customers = [randomUUID(), randomUUID()];
  for (const [i, driver, quantity] of [
    [0, fixtureIds.driver, 85],
    [1, "00000000-0000-0000-0000-000000000003", 65],
  ] as const) {
    await admin.rpc("save_vehicle", {
      p_id: vehicles[i],
      p_plate: `OFFLINE-NIGHT-${i}`,
      p_description: "",
      p_active: true,
      p_version: 0,
      p_reason: "Isolated overnight scenario",
      p_key: randomUUID(),
    });
    await admin.rpc("save_customer", {
      p_id: customers[i],
      p_name: `Night customer ${i}`,
      p_shop: "",
      p_phone: "",
      p_address: "",
      p_notes: "",
      p_active: true,
      p_version: 0,
      p_reason: "Isolated overnight scenario",
      p_key: randomUUID(),
    });
    await admin.rpc("schedule_trip", {
      p_id: trips[i],
      p_driver: driver,
      p_vehicle: vehicles[i],
      p_day: current.id,
      p_scheduled: tomorrow,
      p_notes: "",
      p_key: randomUUID(),
    });
    await admin.rpc("load_trip", {
      p_trip: trips[i],
      p_items: [
        { product_id: fixtureIds.jar, stock_kind: "FULL_JAR", quantity },
      ],
      p_key: randomUUID(),
    });
  }
  // Cache tomorrow's confirmed allocation tonight. Reopening without internet
  // can show assigned stock, but cannot start or deliver before authorization.
  await login(page);
  await expect(page.getByTestId("driver-remaining-full-jars")).toHaveText("65");
  await expect(page.getByText("Offline ready", { exact: true })).toBeVisible({
    timeout: 30000,
  });

  await expect(page.getByText("All synced", { exact: true })).toBeVisible({
    timeout: 30000,
  });
  await context.setOffline(true);
  await page.reload();
  await en(page);

  await expect(page.getByTestId("driver-remaining-full-jars")).toHaveText("65");
  await expect(
    page.getByRole("button", { name: "Start delivering", exact: true }),
  ).toHaveCount(0);
  await context.setOffline(false);
  await admin.rpc("business_day_command", {
    p_operation: "REVIEW",
    p_day: current.id,
    p_data: { version: 1 },
    p_key: randomUUID(),
  });
  await admin.rpc("business_day_command", {
    p_operation: "CLOSE",
    p_day: current.id,
    p_data: {
      version: 2,
      cash_counted: "0",
      notes: "Warehouse 20, vehicle A 85 and B 65 physically confirmed",
      cash_checked: true,
      fonepay_checked: true,
      stock_checked: true,
      balances_checked: true,
      confirmed: true,
    },
    p_key: randomUUID(),
  });
  const archived = (
    await admin.rpc<DayDetail>("business_day_report", { p_day: current.id })
  ).report;
  const next = await admin.rpc<string>("open_inventory_business_day", {
    p_key: randomUUID(),
  });
  expect(
    (
      await request.post(`${provider}/next-business-date`, {
        data: { day: next, date: tomorrow },
      })
    ).ok(),
  ).toBe(true);
  await driverA.rpc("transition_trip", {
    p_trip: trips[0],
    p_action: "START",
    p_reason: "",
    p_key: randomUUID(),
  });
  await driverA.rpc("post_driver_delivery", {
    p_trip: trips[0],
    p_customer: customers[0],
    p_walk_name: "",
    p_walk_phone: "",
    p_items: [
      { product_id: fixtureIds.jar, full_jars: 50, empty_jars: 15, cartons: 0 },
    ],
    p_status: "CREDIT",
    p_received: null,
    p_notes: "",
    p_key: randomUUID(),
  });
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByTestId("driver-remaining-full-jars")).toHaveText("65");
  await page
    .getByRole("button", { name: "Start delivering", exact: true })
    .click();
  await expect(
    page.getByText("Record saved.", { exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByText("All synced", { exact: true })).toBeVisible({
    timeout: 30000,
  });
  await context.setOffline(true);
  await nav(page, "New Sale");
  expect(new URL(page.url()).pathname).toBe("/driver/delivery");
  await page.locator(`[data-customer-id="${customers[1]}"]`).click();
  await page.getByLabel("Jars Delivered", { exact: true }).fill("30");
  await page.getByLabel("Empty Jars Returned", { exact: true }).fill("10");
  await page.getByRole("button", { name: "Credit", exact: true }).click();
  await page
    .getByRole("button", { name: "Review delivery", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Save Delivery", exact: true })
    .click();
  await expect(
    page.getByText("Saved on phone", { exact: true }).first(),
  ).toBeVisible();
  await nav(page, "My Stock");
  await expect(page.getByTestId("driver-remaining-full-jars")).toHaveText("35");
  await page.reload();
  await en(page);

  await expect(page.getByTestId("driver-remaining-full-jars")).toHaveText("35");
  // Lose the reply only AFTER the durable server commit; the automatic retry
  // must recognize the original ID instead of inserting another delivery.
  let committed = false;
  await page.route("**/api/driver/offline", async (route) => {
    const body = route.request().postDataJSON();
    if (body?.action === "post" && !committed) {
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      committed = true;
      await route.abort("failed");
    } else await route.continue();
  });
  await context.setOffline(false);
  await expect.poll(() => committed, { timeout: 30000 }).toBe(true);
  await expect(page.getByText("All synced", { exact: true })).toBeVisible({
    timeout: 30000,
  });
  const w = await admin.workspace(trips[1]);
  expect(w.loads[0]?.quantity).toBe(65);
  expect(w.visits).toHaveLength(1);
  expect(
    w.movements.filter((m) => m.movement_type === "TRIP_LOAD"),
  ).toHaveLength(1);
  const daily = (
    await admin.rpc<DayDetail>("business_day_report", { p_day: next })
  ).report;
  expect(daily.totals).toMatchObject({ full_jars: 80, empty_jars: 25 });
  expect(
    (await admin.rpc<DayDetail>("business_day_report", { p_day: current.id }))
      .report,
  ).toEqual(archived);
  const own = (await driverB.workspace(trips[1])).trips[0]!;
  expect(own.scheduled_date).toBe(tomorrow);
  expect(own.business_day_id).toBe(next);
  // Continue this registered device through a second closing period using a
  // confirmed PAUSE, keeping the same trip, journal, and original 65-jar load.
  await nav(page, "My Stock");
  await page
    .getByRole("button", { name: "Pause for overnight carryover", exact: true })
    .click();
  await expect(
    page
      .getByText(
        "This trip is paused for carryover. Resume online after admin authorization.",
        { exact: true },
      )
      .first(),
  ).toBeVisible();
  await expect(page.getByText("All synced", { exact: true })).toBeVisible({
    timeout: 30000,
  });
  for (const trip of trips)
    await admin.rpc("trip_preparation_command", {
      p_trip: trip,
      p_action: "CARRYOVER",
      p_scheduled: null,
      p_reason:
        "Authorized overnight continuation after confirmed device pause",
      p_counts: null,
      p_key: randomUUID(),
    });
  await admin.rpc("business_day_command", {
    p_operation: "REVIEW",
    p_day: next,
    p_data: { version: 1 },
    p_key: randomUUID(),
  });
  await admin.rpc("business_day_command", {
    p_operation: "CLOSE",
    p_day: next,
    p_data: {
      version: 2,
      cash_counted: "0",
      notes:
        "Checked carried vehicle stock, journal checkpoint and customer credit",
      cash_checked: true,
      fonepay_checked: true,
      stock_checked: true,
      balances_checked: true,
      confirmed: true,
    },
    p_key: randomUUID(),
  });
  const third = await admin.rpc<string>("open_inventory_business_day", {
    p_key: randomUUID(),
  });
  expect(
    (
      await request.post(`${provider}/next-business-date`, {
        data: { day: third, date: shiftDate(tomorrow, 1) },
      })
    ).ok(),
  ).toBe(true);
  await driverA.rpc("transition_trip", {
    p_trip: trips[0],
    p_action: "CONTINUE",
    p_reason: "",
    p_key: randomUUID(),
  });
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Resume carried trip", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Resume carried trip", exact: true })
    .click();
  await expect(
    page.getByText(
      "This trip is paused for carryover. Resume online after admin authorization.",
      { exact: true },
    ),
  ).toHaveCount(0);
  await expect(page.getByTestId("driver-remaining-full-jars")).toHaveText("35");
  await context.setOffline(true);
  await nav(page, "New Sale");
  await page.locator(`[data-customer-id="${customers[1]}"]`).click();
  await page.getByLabel("Jars Delivered", { exact: true }).fill("5");
  await page.getByLabel("Empty Jars Returned", { exact: true }).fill("0");
  await page.getByRole("button", { name: "Credit", exact: true }).click();
  await page
    .getByRole("button", { name: "Review delivery", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Save Delivery", exact: true })
    .click();
  await expect(
    page.getByText("Saved on phone", { exact: true }).first(),
  ).toBeVisible();
  await context.setOffline(false);
  await expect(page.getByText("All synced", { exact: true })).toBeVisible({
    timeout: 30000,
  });
  expect(
    (await admin.workspace(trips[1])).movements.filter(
      (m) => m.movement_type === "TRIP_LOAD",
    ),
  ).toHaveLength(1);
  expect(
    (await admin.rpc<DayDetail>("business_day_report", { p_day: third })).report
      .totals.full_jars,
  ).toBe(5);
  expect(
    (await admin.rpc<DayDetail>("business_day_report", { p_day: next })).report
      .totals.full_jars,
  ).toBe(80);
});
