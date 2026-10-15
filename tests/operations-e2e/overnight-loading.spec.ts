import { openAdminMenuForSignOut } from "./fixture-client";
import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { fixtureClient, fixtureIds } from "./fixture-client";
import {
  adToBs,
  formatBusinessDate,
  shiftDate,
} from "../../src/domain/localization/calendar";
import type { DayDetail } from "../../src/domain/business-days/types";
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
}
async function save(page: Page, label: string) {
  const action = page.waitForResponse(
    (r) =>
      r.request().method() === "POST" && !!r.request().headers()["next-action"],
  );
  await page.getByRole("button", { name: label, exact: true }).click();
  expect((await action).ok()).toBe(true);
  await expect(
    page.getByText(/^(Saved to the database\.|Saved to Supabase\.)$/).first(),
  ).toBeVisible();
}
async function pick(page: Page, date: string) {
  await page
    .getByRole("button", { name: "Scheduled delivery date", exact: true })
    .click();
  const calendar = page.getByRole("dialog", {
      name: "BS calendar",
      exact: true,
    }),
    bs = adToBs(date);
  await calendar
    .getByLabel("BS year", { exact: true })
    .selectOption(String(bs.year));
  await calendar
    .getByLabel("BS month", { exact: true })
    .selectOption(String(bs.month));
  await calendar
    .getByRole("button", { name: formatBusinessDate(date), exact: true })
    .click();
}
test("night loads remain prepared through closing and drivers use 85/65 without another deduction", async ({
  page,
  request,
}) => {
  page.on("dialog", (d) => d.accept());
  await request.post("http://127.0.0.1:17777/reset");
  const admin = await fixtureClient(request),
    driverA = await fixtureClient(request, "driver"),
    driverB = await fixtureClient(request, "other");
  const initial = await admin.workspace(),
    day = initial.days[0]!,
    tomorrow = shiftDate(day.date_label, 1),
    warehouse = initial.locations.find((l) => l.code === "MAIN")!.id;
  await admin.rpc("adjust_warehouse_stock", {
    p_product: fixtureIds.jar,
    p_kind: "FULL_JAR",
    p_delta: 70,
    p_reason: "Isolated 170 jar scenario",
    p_notes: "",
    p_day: day.id,
    p_key: randomUUID(),
  });
  const vehicleA = randomUUID(),
    vehicleB = randomUUID(),
    customerA = randomUUID(),
    customerB = randomUUID();
  for (const [id, plate] of [
    [vehicleA, "NIGHT-A"],
    [vehicleB, "NIGHT-B"],
  ])
    await admin.rpc("save_vehicle", {
      p_id: id,
      p_plate: plate,
      p_description: "",
      p_active: true,
      p_version: 0,
      p_reason: "Isolated night loading",
      p_key: randomUUID(),
    });
  for (const [id, name] of [
    [customerA, "Night customer A"],
    [customerB, "Night customer B"],
  ])
    await admin.rpc("save_customer", {
      p_id: id,
      p_name: name,
      p_shop: "",
      p_phone: "",
      p_address: "",
      p_notes: "",
      p_active: true,
      p_version: 0,
      p_reason: "Isolated night loading",
      p_key: randomUUID(),
    });
  await login(page);
  const trips: string[] = [];
  for (const [driver, vehicle, quantity] of [
    ["Fixture driver", "NIGHT-A", "85"],
    ["Other driver", "NIGHT-B", "65"],
  ] as const) {
    await page.goto("/admin/trips");
    await pick(page, tomorrow);
    await page
      .getByTestId("create-trip-section")
      .getByLabel("Driver", { exact: true })
      .selectOption({ label: driver });
    await page
      .getByTestId("create-trip-section")
      .getByLabel("Vehicle", { exact: true })
      .selectOption({ label: vehicle });
    await save(page, "Create draft trip");
    await page
      .getByRole("link", { name: "Open saved trip", exact: true })
      .click();
    await expect(page).toHaveURL(/\/admin\/trips\/[0-9a-f-]{36}$/);
    const trip = new URL(page.url()).pathname.split("/").at(-1)!;
    trips.push(trip);
    expect(
      (await admin.workspace()).balances.find(
        (b) =>
          b.location_id === warehouse &&
          b.product_id === fixtureIds.jar &&
          b.stock_kind === "FULL_JAR",
      )!.quantity,
    ).toBe(quantity === "85" ? 170 : 85);
    await page
      .getByRole("checkbox", { name: "20L test jar", exact: true })
      .check();
    await page.getByLabel("20L test jar load", { exact: true }).fill(quantity);
    await save(page, "Confirm warehouse loading");
    await page.reload();
    await expect(page.getByText(/^Physical loading confirmed/)).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Start trip", exact: true }),
    ).toHaveCount(0);
  }
  await page.goto("/admin/daily-close");
  await expect(
    page.getByRole("heading", {
      name: "Prepared for tomorrow and later",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "2 trips are prepared for a future date. They remain prepared after this business day is closed.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page.getByText("Total prepared jars", { exact: true }).locator(".."),
  ).toContainText("150");
  await expect(
    page
      .getByText("Warehouse available full jars", { exact: true })
      .locator(".."),
  ).toContainText("20");
  await expect(page.getByText(/No critical blockers/)).toBeVisible();
  await save(page, "Begin closing review");
  await page.reload();
  await page
    .getByLabel("Net cash handed over (NPR)", { exact: true })
    .fill("0");
  await page
    .getByLabel("Reconciliation evidence / closing notes", { exact: true })
    .fill(
      "Warehouse 20, vehicles 85 and 65 verified; future deliveries remain prepared",
    );
  for (const checkbox of await page.getByRole("checkbox").all())
    await checkbox.check();
  await save(page, "Confirm and close business day");
  const old = await admin.rpc<DayDetail>("business_day_report", {
    p_day: day.id,
  });
  expect(old.report.source).toBe("ARCHIVED");
  expect(old.report.totals.sales).toBe("0");
  await page.goto("/admin/daily-close");
  await page
    .getByRole("button", { name: "Open business day", exact: true })
    .click();
  await expect
    .poll(async () =>
      (await admin.workspace()).days.some((d) => d.status === "OPEN"),
    )
    .toBe(true);
  const next = (await admin.workspace()).days.find((d) => d.status === "OPEN")!;
  expect(
    (
      await request.post("http://127.0.0.1:17777/next-business-date", {
        data: { day: next.id, date: tomorrow },
      })
    ).ok(),
  ).toBe(true);
  await openAdminMenuForSignOut(page);
  await page.getByRole("button", { name: "Sign Out", exact: true }).click();
  await expect(page).toHaveURL(/sign-in/);
  await login(page, "driver");
  await expect(page.getByTestId("driver-remaining-full-jars")).toHaveText("85");
  await save(page, "Start delivering");
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "New Sale", exact: true })
    .click();
  await expect(page).toHaveURL(/driver\/delivery/);
  await page.locator(`[data-customer-id="${customerA}"]`).click();
  await page.getByLabel("Jars Delivered", { exact: true }).fill("50");
  await page.getByLabel("Empty Jars Returned", { exact: true }).fill("15");
  await page.getByRole("button", { name: "Credit", exact: true }).click();
  await page
    .getByRole("button", { name: "Review delivery", exact: true })
    .click();
  await save(page, "Save Delivery");
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "My Stock", exact: true })
    .click();
  await expect(page.getByTestId("driver-remaining-full-jars")).toHaveText("35");
  await driverB.rpc("transition_trip", {
    p_trip: trips[1],
    p_action: "START",
    p_reason: "",
    p_key: randomUUID(),
  });
  await driverB.rpc("post_driver_delivery", {
    p_trip: trips[1],
    p_customer: customerB,
    p_walk_name: "",
    p_walk_phone: "",
    p_items: [
      { product_id: fixtureIds.jar, full_jars: 30, empty_jars: 10, cartons: 0 },
    ],
    p_status: "CREDIT",
    p_received: null,
    p_notes: "",
    p_key: randomUUID(),
  });
  const w = await admin.workspace();
  for (const trip of trips)
    expect(
      (await admin.workspace(trip)).movements.filter(
        (m) => m.movement_type === "TRIP_LOAD",
      ),
    ).toHaveLength(1);
  const b = w.vehicles.find((v) => v.id === vehicleB)!;
  expect(
    w.balances.find(
      (r) =>
        r.location_id === b.location_id &&
        r.product_id === fixtureIds.jar &&
        r.stock_kind === "FULL_JAR",
    )!.quantity,
  ).toBe(35);
  const result = await admin.rpc<DayDetail>("business_day_report", {
    p_day: next.id,
  });
  expect(result.report.totals).toMatchObject({ full_jars: 80, empty_jars: 25 });
  expect(
    (await admin.rpc<DayDetail>("business_day_report", { p_day: day.id }))
      .report,
  ).toEqual(old.report);
  expect((await driverA.workspace(trips[0])).loads[0]?.quantity).toBe(85);
});
