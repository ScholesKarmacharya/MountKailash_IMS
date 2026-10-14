import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import { activeFixtureTrip, fixtureIds } from "./fixture-client";
import type { DayDetail } from "../../src/domain/business-days/types";
import type { FinanceWorkspace } from "../../src/domain/finance/types";
import {
  formatBusinessDate,
  shiftDate,
} from "../../src/domain/localization/calendar";
import { npr } from "../../src/domain/finance/money";
import ne from "../../src/lib/i18n/ne.json";

test("overview preserves warehouse/finance facts, separates future loads, explains blockers and closes safely", async ({
  page,
  request,
}, testInfo) => {
  const f = await activeFixtureTrip(request, 60);
  const original = await f.admin.workspace(f.trip);
  const vehicle = original.trips[0]!.vehicle_id;
  const day = original.days.find((d) => d.status === "OPEN")!;
  const warehouse = original.locations.find((l) => l.code === "MAIN")!.id;
  const carton = "00000000-0000-0000-0000-000000000012";
  const visit = async (
    trip: string,
    full: number,
    empty: number,
    selection: string,
    cartons = 0,
  ) =>
    f.driver.rpc("post_trip_visit", {
      p_trip: trip,
      p_customer: f.customer,
      p_walk_name: "",
      p_walk_phone: "",
      p_items: [
        {
          product_id: fixtureIds.jar,
          full_jars: full,
          empty_jars: empty,
          cartons: 0,
        },
        ...(cartons
          ? [{ product_id: carton, full_jars: 0, empty_jars: 0, cartons }]
          : []),
      ],
      p_payment: { selection },
      p_notes: "",
      p_key: randomUUID(),
    });
  const settle = async (
    trip: string,
    full: number,
    empty: number,
    cartons = 0,
    reconcile = true,
  ) => {
    const counts = [
      { product_id: fixtureIds.jar, stock_kind: "FULL_JAR", quantity: full },
      { product_id: fixtureIds.jar, stock_kind: "EMPTY_JAR", quantity: empty },
      ...(cartons
        ? [
            {
              product_id: carton,
              stock_kind: "BOTTLE_CARTON",
              quantity: cartons,
            },
          ]
        : []),
    ];
    await f.driver.rpc("submit_trip", {
      p_trip: trip,
      p_counts: counts,
      p_key: randomUUID(),
    });
    if (reconcile)
      await f.admin.rpc("reconcile_trip", {
        p_trip: trip,
        p_counts: counts,
        p_reason: "Isolated physical counts",
        p_accept_variance: false,
        p_key: randomUUID(),
      });
    return counts;
  };
  await visit(f.trip, 20, 15, "CASH");
  await visit(f.trip, 10, 0, "UNPAID");
  await settle(f.trip, 30, 15);
  const process = (operation: string, quantity: number) =>
    f.admin.rpc("process_warehouse_jars", {
      p_day: day.id,
      p_product: fixtureIds.jar,
      p_operation: operation,
      p_kind: operation === "REFILL" ? "EMPTY_JAR" : "FULL_JAR",
      p_quantity: quantity,
      p_reason: "Isolated processing check",
      p_key: randomUUID(),
    });
  await process("REFILL", 10);
  await process("DAMAGE", 3);
  const current = randomUUID(),
    future = randomUUID(),
    futureVehicle = randomUUID();
  await f.admin.rpc("create_trip", {
    p_id: current,
    p_driver: fixtureIds.driver,
    p_vehicle: vehicle,
    p_day: day.id,
    p_customers: [],
    p_notes: "",
    p_key: randomUUID(),
  });
  await f.admin.rpc("load_trip", {
    p_trip: current,
    p_items: [
      { product_id: fixtureIds.jar, stock_kind: "FULL_JAR", quantity: 30 },
      { product_id: carton, stock_kind: "BOTTLE_CARTON", quantity: 2 },
    ],
    p_key: randomUUID(),
  });
  await f.driver.rpc("transition_trip", {
    p_trip: current,
    p_action: "START",
    p_reason: "",
    p_key: randomUUID(),
  });
  await f.admin.rpc("save_vehicle", {
    p_id: futureVehicle,
    p_plate: "FUTURE-2102",
    p_description: "",
    p_active: true,
    p_version: 0,
    p_reason: "Isolated future load",
    p_key: randomUUID(),
  });
  const all = await f.admin.workspace();
  const other = all.drivers.find((d) => d.id !== fixtureIds.driver)!;
  await f.admin.rpc("schedule_trip", {
    p_id: future,
    p_driver: other.id,
    p_vehicle: futureVehicle,
    p_day: day.id,
    p_scheduled: shiftDate(day.date_label, 1),
    p_notes: "",
    p_key: randomUUID(),
  });
  await f.admin.rpc("load_trip", {
    p_trip: future,
    p_items: [
      { product_id: fixtureIds.jar, stock_kind: "FULL_JAR", quantity: 20 },
      { product_id: carton, stock_kind: "BOTTLE_CARTON", quantity: 3 },
    ],
    p_key: randomUUID(),
  });
  await visit(current, 8, 3, "CASH", 1);
  await visit(current, 5, 2, "FONEPAY");
  await process("REFILL", 1);
  await process("DAMAGE", 1);
  const getDetail = () =>
    f.admin.rpc<DayDetail>("business_day_report", { p_day: day.id });
  const detail = await getDetail();
  const facts = await f.admin.workspace();
  const warehouseQuantity = (kind: string) =>
    facts.balances
      .filter((b) => b.location_id === warehouse && b.stock_kind === kind)
      .reduce((n, b) => n + b.quantity, 0);

  await page.goto("/sign-in");
  await page.getByRole("button", { name: "English", exact: true }).click();
  await page.getByLabel("Email address").fill("admin@fixture.example");
  await page.getByLabel("Password", { exact: true }).fill("fixture-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/admin\/dashboard/);
  await page.getByRole("button", { name: "English", exact: true }).click();
  const overview = page.getByTestId("admin-overview");
  await expect(page.getByTestId("overview-business-date")).toContainText(
    formatBusinessDate(day.date_label),
  );
  for (const kind of ["FULL_JAR", "EMPTY_JAR", "BOTTLE_CARTON"])
    await expect(page.getByTestId("overview-stock-" + kind)).toHaveText(
      String(warehouseQuantity(kind)),
    );
  expect(warehouseQuantity("FULL_JAR")).toBe(27);
  await expect(page.getByTestId("overview-trips-active")).toHaveText("1");
  await expect(page.getByTestId("overview-trips-awaiting")).toHaveText("0");
  await expect(page.getByTestId("overview-trips-prepared")).toHaveText("1");
  await expect(page.getByTestId("overview-trips-completed")).toHaveText("1");
  const financial = {
    sales: detail.report.totals.sales,
    collections: detail.report.totals.collections,
    issued: detail.report.totals.new_credit,
    outstanding: detail.report.totals.outstanding,
    cash: detail.report.totals.cash,
    pending: detail.report.totals.pending_fonepay,
    fonepay: detail.report.totals.fonepay,
    recovered: detail.report.totals.old_credit_recovered,
    deposits: detail.report.totals.deposit_liability,
  };
  const breakdown = page.getByTestId("overview-finance-breakdown");
  await expect(breakdown).not.toHaveAttribute("open", "");
  await breakdown.locator("summary").click();
  for (const [id, value] of Object.entries(financial))
    await expect(page.getByTestId("overview-finance-" + id)).toHaveText(
      npr(value),
    );
  await breakdown.locator("summary").click();
  const closing = page.getByTestId("overview-closing");
  await expect(closing).toContainText(detail.blockers.length + " blockers");
  for (const blocker of detail.blockers)
    await expect(
      closing.locator('a[href="' + blocker.href + '"]'),
    ).toBeVisible();
  const currentCard = page.getByTestId("overview-driver-" + current);
  const quantity = (label: string) =>
    currentCard.getByText(label, { exact: true }).locator("..").locator("dd");
  await expect(quantity("Full jars loaded")).toHaveText("30");
  await expect(quantity("Full jars sold")).toHaveText("13");
  await expect(quantity("Remaining full jars")).toHaveText("17");
  await expect(quantity("Empty jars collected")).toHaveText("5");
  await expect(page.getByTestId("overview-driver-" + future)).toHaveCount(0);
  await expect(page.getByTestId("overview-prepared")).toContainText(
    "FUTURE-2102",
  );
  await expect(page.getByTestId("overview-prepared")).toContainText(
    formatBusinessDate(shiftDate(day.date_label, 1)),
  );
  await currentCard.locator("summary").click();
  await expect(
    currentCard.getByText("Cartons loaded", { exact: true }),
  ).toBeVisible();
  await expect(
    currentCard.getByText("Pending jars at visited customers", { exact: true }),
  ).toBeVisible();
  await currentCard.locator("summary").click();
  const activity = page.getByTestId("overview-activity");
  await expect(activity).not.toContainText(
    /TRIP_LOAD|FULL_JAR|REFILL_INPUT|REFILL_OUTPUT|EMPTY_COLLECTION/,
  );
  await expect(activity).toContainText("1 full jars added after refilling");
  await expect(activity).toContainText("damaged stock");

  const refreshed = await page
    .getByTestId("overview-updated-at")
    .getAttribute("datetime");
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByTestId("overview-updated-at")).not.toHaveAttribute(
    "datetime",
    refreshed!,
  );
  await expect(page.getByTestId("overview-refresh")).toContainText(
    "Last updated just now",
  );
  // A real server update reaches the overview through the existing timer.
  await visit(current, 0, 1, "UNPAID");
  await expect(quantity("Empty jars collected")).toHaveText("6", {
    timeout: 20000,
  });
  const originalTrips = (await f.admin.workspace()).trips;
  expect(originalTrips.find((t) => t.id === current)?.status).toBe("ACTIVE");
  expect(originalTrips.find((t) => t.id === future)?.status).toBe("LOADED");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await overview.screenshot({
    path: "test-results/overview-" + testInfo.project.name + "-en.png",
    scale: "css",
  });
  await page.getByRole("button", { name: "नेपाली", exact: true }).click();
  await expect(
    overview.getByRole("heading", {
      name: ne["Financial overview"],
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByTestId("overview-business-date")).toContainText(
    formatBusinessDate(day.date_label, "ne"),
  );
  await expect(
    overview.getByText("Today's Sales", { exact: true }),
  ).toHaveCount(0);
  await expect(closing).not.toContainText("still holds stock");
  await expect(closing).not.toContainText("awaits Fonepay reconciliation");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await overview.screenshot({
    path: "test-results/overview-" + testInfo.project.name + "-ne.png",
    scale: "css",
  });
  await page.getByRole("button", { name: "English", exact: true }).click();
  await currentCard
    .getByRole("link", { name: "View Trip Details", exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp("/admin/trips/" + current + "$"));
  await page.goto("/admin/dashboard");
  await page
    .getByTestId("overview-business-day")
    .getByRole("link", { name: "Review Daily Close", exact: true })
    .click();
  await expect(page).toHaveURL(/admin\/daily-close/);
  await page.goto("/admin/dashboard");
  await page
    .getByRole("link", { name: "Manage Inventory", exact: true })
    .click();
  await expect(page).toHaveURL(/admin\/inventory/);
  await page.goto("/admin/dashboard");
  await page
    .getByRole("link", { name: "View permanent audit records", exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp("/admin/reports/" + day.id + "$"));

  // Use the existing safeguards to close, with the future load still on its vehicle.
  const finance = await f.admin.rpc<FinanceWorkspace>("finance_workspace", {});
  for (const receipt of finance.payments.filter((p) => p.status === "PENDING"))
    await f.admin.rpc("finance_command", {
      p_operation: "VERIFY",
      p_data: {
        payment: receipt.id,
        day: day.id,
        decision: "CONFIRM",
        reference: "Isolated receipt evidence",
        reason: "Reconciled isolated receipt",
      },
      p_key: randomUUID(),
    });
  const submitted = await settle(current, 17, 6, 1, false);
  await page.goto("/admin/dashboard");
  await expect(page.getByTestId("overview-trips-active")).toHaveText("0");
  await expect(page.getByTestId("overview-trips-awaiting")).toHaveText("1");
  await expect(page.getByTestId("overview-trips-prepared")).toHaveText("1");
  expect(
    (await f.admin.workspace()).trips.find((t) => t.id === current)?.status,
  ).toBe("SUBMITTED");
  await f.admin.rpc("reconcile_trip", {
    p_trip: current,
    p_counts: submitted,
    p_reason: "Isolated physical counts",
    p_accept_variance: false,
    p_key: randomUUID(),
  });
  let ready = await getDetail();
  expect(ready.blockers).toHaveLength(0);
  await f.admin.rpc("business_day_command", {
    p_operation: "REVIEW",
    p_day: day.id,
    p_data: { version: ready.report.day.version },
    p_key: randomUUID(),
  });
  ready = await getDetail();
  await page.goto("/admin/dashboard");
  await expect(page.getByTestId("overview-business-day")).toContainText(
    "Closing Review",
  );
  await f.admin.rpc("business_day_command", {
    p_operation: "CLOSE",
    p_day: day.id,
    p_data: {
      version: ready.report.day.version,
      cash_counted: ready.report.totals.cash_net,
      notes: "Isolated physical stock and cash checked",
      cash_checked: true,
      fonepay_checked: true,
      stock_checked: true,
      balances_checked: true,
      confirmed: true,
    },
    p_key: randomUUID(),
  });
  await page.goto("/admin/dashboard");
  await expect(page.getByTestId("overview-business-day")).toContainText(
    "Last closed business day",
  );
  await expect(page.getByTestId("overview-business-day")).toContainText(
    "CLOSED",
  );
  await expect(page.getByTestId("overview-business-date")).toContainText(
    formatBusinessDate(day.date_label),
  );
  await expect(page.getByTestId("overview-trips-prepared")).toHaveText("1");
  await expect(page.getByTestId("overview-prepared")).toContainText(
    "Full jars loaded: 20",
  );
  await expect(page.getByTestId("overview-finance-sales")).toHaveText(
    "No active day",
  );
  expect(
    (await f.admin.workspace()).trips.find((t) => t.id === future)?.status,
  ).toBe("LOADED");
});
