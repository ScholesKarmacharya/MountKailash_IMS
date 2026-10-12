import { randomUUID } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import { activeFixtureTrip, fixtureIds } from "./fixture-client";
import { parseCommand } from "../../src/domain/operations/commands";
import type { FinanceWorkspace } from "../../src/domain/finance/types";
import type { DeliveryCustomerContext } from "../../src/domain/operations/customer-context";
import type {
  DayDetail,
  HistoryDay,
} from "../../src/domain/business-days/types";

async function login(page: Page, role = "driver") {
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "English", exact: true }).click();
  await page.getByLabel("Email address").fill(`${role}@fixture.example`);
  await page.getByLabel("Password", { exact: true }).fill("fixture-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(
    role === "admin" ? /admin\/dashboard/ : /driver\/home/,
  );
  page.removeAllListeners("dialog");
  page.on("dialog", (d) => d.accept());

  await page.getByRole("button", { name: "English", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "English", exact: true }),
  ).toBeEnabled();
}
async function save(page: Page, name: string) {
  const response = page.waitForResponse(
    (r) =>
      r.request().method() === "POST" && !!r.request().headers()["next-action"],
  );
  await page.getByRole("button", { name, exact: true }).click();
  expect((await response).ok()).toBe(true);
}
async function card(page: Page, label: string, value: number) {
  await expect(
    page
      .getByRole("region", { name: "Delivery stock", exact: true })
      .locator("section.rounded-xl")
      .filter({ has: page.getByRole("heading", { name: label, exact: true }) })
      .locator("p"),
  ).toHaveText(String(value));
}
async function record(
  page: Page,
  full: number,
  empty: number,
  selection = "Monthly credit / unpaid",
  cartons = 0,
) {
  await page
    .getByLabel("Full jars delivered", { exact: true })
    .fill(String(full));
  await page
    .getByLabel("Empty jars collected", { exact: true })
    .fill(String(empty));
  await page
    .getByLabel("Cartons delivered", { exact: true })
    .fill(String(cartons));
  await page.getByRole("button", { name: selection, exact: true }).click();
  if (selection === "Partial payment")
    await page
      .getByLabel("Amount received for this invoice (NPR)", { exact: true })
      .fill("50");
  await page
    .getByRole("button", { name: "Review delivery", exact: true })
    .click();
  const entries = await page
    .locator('input[name="operation"][value="visit"]')
    .locator("..")
    .evaluate((form) =>
      Array.from(new FormData(form as HTMLFormElement).entries()).map(
        ([k, v]) => [k, String(v)],
      ),
    );
  const data = new FormData();
  for (const [k, v] of entries) data.set(k!, v!);
  const command = parseCommand(data);
  await save(page, "Save Delivery");
  return command;
}

test("driver inventory, simplified selling, audited returns and automatic second load reconcile across business days", async ({
  page,
  request,
  browser,
}) => {
  test.setTimeout(180000);
  const { admin, driver, trip, customer } = await activeFixtureTrip(
    request,
    100,
    2,
  );
  const base = await admin.workspace(trip);
  const day = base.trips[0]!.business_day_id;
  const vehicle = base.trips[0]!.vehicle_id;
  // Isolated fixture stock only: sufficient genuine test capacity for two rounds.
  await admin.rpc("adjust_warehouse_stock", {
    p_product: fixtureIds.jar,
    p_kind: "FULL_JAR",
    p_delta: 100,
    p_reason: "Disposable two-round fixture",
    p_notes: "",
    p_day: day,
    p_key: randomUUID(),
  });
  const adminContext = await browser.newContext({
    viewport: page.viewportSize()!,
  });
  const adminPage = await adminContext.newPage();
  try {
    await login(adminPage, "admin");
    await login(page);
    await card(page, "Total Jars Loaded", 100);
    await card(page, "Remaining Full Jars", 100);
    await card(page, "Full Jars Sold", 0);
    await card(page, "Empty Jars Collected", 0);
    await card(page, "Total Cartons Loaded", 2);
    await page
      .locator("main")
      .getByRole("link", { name: "New Delivery", exact: true })
      .click();
    await page
      .getByRole("button", {
        name: "Increase Full jars delivered",
        exact: true,
      })
      .click();
    await expect(
      page.getByLabel("Full jars delivered", { exact: true }),
    ).toHaveValue("1");
    await page
      .getByRole("button", { name: "Add New Customer", exact: true })
      .click();
    await page.getByLabel("Customer name", { exact: true }).fill("ABC Hotel");
    await page
      .getByLabel("Contact person (optional)", { exact: true })
      .fill("Hotel manager");
    await page
      .getByLabel("Customer type (optional)", { exact: true })
      .fill("Hotel");
    await page
      .getByLabel("Delivery notes (optional)", { exact: true })
      .fill("Use rear entrance");
    await save(page, "Save and select customer");
    await expect(
      page.getByText("Selected: ABC Hotel", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByLabel("Full jars delivered", { exact: true }),
    ).toHaveValue("1");
    const hotel = (await admin.workspace()).customers.find(
      (c) => c.name === "ABC Hotel",
    )!;
    expect(hotel).toMatchObject({
      contact_person: "Hotel manager",
      customer_type: "Hotel",
      delivery_notes: "Use rear entrance",
      created_by: fixtureIds.driver,
    });
    const command = await record(page, 35, 30, "Partial payment", 1);
    await expect
      .poll(async () => (await admin.workspace(trip)).visits.length)
      .toBe(1);
    const persisted = await admin.workspace(trip);
    expect(await driver.rpc(command.rpc, command.args)).toBe(
      persisted.visits[0]!.id,
    );
    expect((await admin.workspace(trip)).movements).toEqual(
      persisted.movements,
    );
    expect((await admin.workspace(trip)).balances).toEqual(persisted.balances);
    const c = () =>
      driver.rpc<DeliveryCustomerContext>("delivery_customer_context", {
        p_trip: trip,
        p_customer: hotel.id,
      });
    await expect
      .poll(async () => (await c()).pending_jars?.[0]?.pending)
      .toBe(5);
    const original = (await c()).pending_jars![0]!.original_date;
    await page.goto("/driver/home");
    await card(page, "Remaining Full Jars", 65);
    await card(page, "Full Jars Sold", 35);
    await card(page, "Empty Jars Collected", 30);
    await card(page, "Cartons Remaining", 1);
    await expect(
      adminPage
        .getByRole("region", { name: "Driver activity", exact: true })
        .getByText("Full jars sold", { exact: true })
        .locator("..")
        .locator("dd"),
    ).toHaveText("35", { timeout: 20000 });
    await page.goto(`/driver/delivery?customer=${customer}`);
    await expect(
      page.getByText("Selected: Refresh customer", { exact: true }),
    ).toBeVisible();
    await record(page, 20, 0);
    await expect
      .poll(async () => (await admin.workspace(trip)).visits.length)
      .toBe(2);
    await page.goto("/driver/home");
    await card(page, "Remaining Full Jars", 45);
    await page.goto("/driver/delivery");
    await page.getByRole("button", { name: "Walk-in", exact: true }).click();
    await record(page, 5, 5, "Cash");
    await expect
      .poll(async () => (await admin.workspace(trip)).visits.length)
      .toBe(3);
    await page.goto(`/driver/delivery?customer=${hotel.id}`);
    await expect(
      page.getByText("Selected: ABC Hotel", { exact: true }),
    ).toBeVisible();
    await record(page, 0, 2);
    await expect
      .poll(async () => (await c()).pending_jars?.[0]?.pending)
      .toBe(3);
    expect((await c()).pending_jars![0]!.original_date).toBe(original);
    const finance = () => admin.rpc<FinanceWorkspace>("finance_workspace", {});
    expect((await finance()).sales).toHaveLength(3);
    expect((await finance()).invoices).toHaveLength(3);
    await page.goto(`/driver/delivery?customer=${hotel.id}`);
    await expect(
      page.getByText("Selected: ABC Hotel", { exact: true }),
    ).toBeVisible();
    await page.getByLabel("Full jars delivered", { exact: true }).fill("41");
    await expect(
      page.getByRole("button", { name: "Review delivery", exact: true }),
    ).toBeDisabled();
    const before = await admin.workspace(trip);
    expect(before.visits).toHaveLength(4);
    expect(
      before.movements.filter(
        (m) => m.stock_kind === "FULL_JAR" && m.movement_type === "DELIVERY",
      ),
    ).toHaveLength(3);
    await page.goto("/driver/return");
    await expect(
      page.getByLabel("Full jars counted", { exact: true }),
    ).toHaveValue("40");
    await expect(
      page.getByLabel("Empty jars counted", { exact: true }),
    ).toHaveValue("37");
    await save(page, "Submit warehouse returns");
    await expect
      .poll(async () => (await admin.workspace(trip)).trips[0]!.status)
      .toBe("SUBMITTED");
    expect((await admin.workspace(trip)).balances).toEqual(before.balances);
    await page.goto("/driver/home");
    await expect(
      page.getByText("Returned / Awaiting Confirmation", { exact: true }),
    ).toBeVisible();
    await adminPage.goto(`/admin/trips/${trip}`);
    await adminPage
      .getByLabel("Verification / discrepancy reason", { exact: true })
      .fill("Disposable physical counts verified");
    await save(adminPage, "Post physical verification");
    await expect
      .poll(async () => (await admin.workspace(trip)).trips[0]!.status)
      .toBe("CLOSED");
    await expect(
      page.getByText(
        "No active delivery stock. Waiting for warehouse loading.",
        { exact: true },
      ),
    ).toBeVisible({ timeout: 20000 });
    const next = randomUUID();
    await admin.rpc("create_trip", {
      p_id: next,
      p_driver: fixtureIds.driver,
      p_vehicle: vehicle,
      p_day: day,
      p_customers: [],
      p_notes: "Second delivery round",
      p_key: randomUUID(),
    });
    await adminPage.goto(`/admin/trips/${next}`);
    await adminPage
      .getByRole("checkbox", { name: "20L test jar", exact: true })
      .check();
    await adminPage.getByLabel("20L test jar load", { exact: true }).fill("80");
    await save(adminPage, "Confirm warehouse loading");
    await expect(page.getByText("Ready to Start", { exact: true })).toBeVisible(
      { timeout: 20000 },
    );
    await card(page, "Total Jars Loaded", 80);
    await card(page, "Full Jars Sold", 0);
    await card(page, "Empty Jars Collected", 0);
    await save(page, "Start delivering");
    await page.goto(`/driver/delivery?customer=${hotel.id}`);
    await expect(
      page.getByText("Selected: ABC Hotel", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Previous Pending Jars: 3", { exact: true }),
    ).toBeVisible();
    await page
      .getByText("Collect previous credit without a new delivery", {
        exact: true,
      })
      .click();
    await page
      .getByLabel("Collection customer", { exact: true })
      .selectOption(hotel.id);
    await page
      .getByLabel("Credit amount received (NPR)", { exact: true })
      .fill("50");
    await save(page, "Collect outstanding credit");
    await expect.poll(async () => (await finance()).payments.length).toBe(3);
    expect((await finance()).sales).toHaveLength(3);
    await page.goto("/driver/return");
    await save(page, "Submit warehouse returns");
    await adminPage.goto(`/admin/trips/${next}`);
    await adminPage
      .getByLabel("Verification / discrepancy reason", { exact: true })
      .fill("Second load returned without sales");
    await save(adminPage, "Post physical verification");
    await expect
      .poll(async () => (await admin.workspace(next)).trips[0]!.status)
      .toBe("CLOSED");
    const detail = (id = day) =>
      admin.rpc<DayDetail>("business_day_report", { p_day: id });
    expect((await detail()).report.totals).toMatchObject({
      full_jars: 60,
      empty_jars: 37,
      cartons: 1,
      cash_net: "851.25",
      outstanding: "8314.00",
    });
    const old = await admin.workspace(trip);
    expect(old.loads.find((l) => l.stock_kind === "FULL_JAR")!.quantity).toBe(
      100,
    );
    expect(
      old.movements
        .filter(
          (m) =>
            m.movement_type === "TRIP_RETURN" && m.stock_kind === "FULL_JAR",
        )
        .reduce((n, m) => n + m.quantity, 0),
    ).toBe(40);
    await adminPage.goto("/admin/daily-close");
    await save(adminPage, "Begin closing review");
    await adminPage
      .getByLabel("Net cash handed over (NPR)", { exact: true })
      .fill("851.25");
    await adminPage
      .getByLabel("Reconciliation evidence / closing notes", { exact: true })
      .fill("Disposable counted cash and journal evidence");
    for (const box of await adminPage.getByRole("checkbox").all())
      await box.check();
    await save(adminPage, "Confirm and close business day");
    await expect
      .poll(async () => (await detail()).report.source)
      .toBe("ARCHIVED");
    const archive = (await detail()).report;
    await save(adminPage, "Open business day");
    const days = await admin.rpc<HistoryDay[]>("business_day_history", {
      p_from: null,
      p_to: null,
    });
    const opened = days.find((d) => d.status === "OPEN")!;
    const report = (await detail(opened.id)).report;
    expect(report.totals).toMatchObject({
      sales: "0",
      cash: "0",
      trips: 0,
      outstanding: "8314.00",
    });
    expect(report.pending_jars?.reduce((n, r) => n + r.pending, 0)).toBe(23);
    expect(
      report.stock.find(
        (s) => s.location_kind === "WAREHOUSE" && s.stock_kind === "FULL_JAR",
      )!.opening,
    ).toBe(140);
    expect(
      report.stock.find(
        (s) => s.location_kind === "WAREHOUSE" && s.stock_kind === "EMPTY_JAR",
      )!.opening,
    ).toBe(37);
    expect((await detail()).report).toEqual(archive);
    await page.goto("/driver/home");
    await page.reload();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(page).toHaveURL(/sign-in/);
    await login(page);
    await page.goto(`/driver/pending-jars?customer=${hotel.id}`);
    await expect(
      page.getByText("3 pending jars", { exact: true }),
    ).toBeVisible();
  } catch (error) {
    await test.info().attach("driver failure", {
      body: await page.locator("main").innerText(),
      contentType: "text/plain",
    });
    throw error;
  } finally {
    await adminContext.close();
  }
});
