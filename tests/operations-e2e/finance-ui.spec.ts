import { test, expect, type Page, type Locator } from "@playwright/test";
import { randomUUID, createHash } from "node:crypto";
import { activeFixtureTrip, fixtureIds } from "./fixture-client";
import { vehicleCounts } from "../../src/domain/operations/types";
import {
  shiftDate,
  formatBusinessDate,
} from "../../src/domain/localization/calendar";
import { canonical } from "../../src/domain/offline/operations";
import type { FinanceWorkspace } from "../../src/domain/finance/types";
import type { DayDetail } from "../../src/domain/business-days/types";
async function login(page: Page) {
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "English", exact: true }).click();
  await page.getByLabel("Email address").fill("admin@fixture.example");
  await page.getByLabel("Password", { exact: true }).fill("fixture-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/admin\/dashboard/);
}
function errors(page: Page) {
  const list: string[] = [];
  page.on("pageerror", (e) => list.push(e.message));
  page.on("console", (m) => {
    if (
      m.type() === "error" &&
      /hydration|cannot contain|cannot be a child|In HTML/.test(m.text())
    )
      list.push(m.text());
  });
  return list;
}
async function layout(page: Page, scope: Locator, file: string) {
  await expect(scope).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(await page.evaluate(() => window.visualViewport?.scale ?? 1)).toBe(1);
  await scope.screenshot({ path: file, scale: "css" });
}
async function save(page: Page, label: string) {
  const result = page.waitForResponse(
    (r) =>
      r.request().method() === "POST" && !!r.request().headers()["next-action"],
  );
  await page.getByRole("button", { name: label, exact: true }).click();
  expect((await result).ok()).toBe(true);
}
async function delivery(
  f: Awaited<ReturnType<typeof activeFixtureTrip>>,
  status = "PAID",
  full = 2,
  empty = 1,
) {
  await f.driver.rpc("post_driver_delivery", {
    p_trip: f.trip,
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
    ],
    p_status: status,
    p_received: status === "PAID" ? "300.50" : null,
    p_notes: "",
    p_key: randomUUID(),
  });
}
test("finance tables, shared filters, credit analysis, exports and grouped billing preserve exact values", async ({
  page,
  request,
}, info) => {
  const f = await activeFixtureTrip(request, 30),
    failures = errors(page);
  page.on("dialog", (d) => d.accept());
  await f.admin.rpc("finance_command", {
    p_operation: "BILLING",
    p_data: {
      customer: f.customer,
      version: 0,
      account_type: "STANDARD",
      due_days: "30",
      deposit_mode: "MANUAL",
      reason: "Confirmed UI fixture account",
    },
    p_key: randomUUID(),
  });
  await delivery(f);
  await delivery(f, "CREDIT", 2, 0);
  const finance = () => f.admin.rpc<FinanceWorkspace>("finance_workspace", {});
  let before = await finance();
  const credit = before.invoices.find((i) => i.outstanding === "300.50")!;
  await f.admin.rpc("finance_command", {
    p_operation: "PAYMENT",
    p_data: {
      trip: f.trip,
      customer: f.customer,
      method: "FONEPAY",
      amount: "100.00",
      deposit_amount: "0.00",
      reference: "ui-fonepay",
      allocations: [{ invoice_id: credit.id, amount: "100.00" }],
    },
    p_key: randomUUID(),
  });
  await f.admin.rpc("finance_command", {
    p_operation: "PAYMENT",
    p_data: {
      trip: f.trip,
      customer: f.customer,
      method: "CASH",
      amount: "50.00",
      deposit_amount: "50.00",
      reference: "",
      allocations: [],
    },
    p_key: randomUUID(),
  });
  before = await finance();
  await login(page);
  await page.goto("/admin/payments");
  const overview = page.getByTestId("finance-overview");
  await expect(overview).toContainText("NPR 601.00");
  await expect(overview).toContainText("NPR 350.50");
  await expect(overview).toContainText("NPR 300.50");
  await expect(overview).toContainText("NPR 100.00");
  await expect(overview).toContainText("NPR 50.00");
  await expect(
    page.getByTestId("invoice-list").locator("tbody tr:visible, dl:visible"),
  ).toHaveCount(2);
  await expect(
    page.getByTestId("receipt-list").locator("tbody tr:visible, dl:visible"),
  ).toHaveCount(3);
  await page.getByLabel("Method", { exact: true }).selectOption("FONEPAY");
  await page.getByLabel("Status", { exact: true }).selectOption("PENDING");
  await page
    .getByRole("button", { name: "Filter history", exact: true })
    .click();
  await expect(
    page.getByTestId("receipt-list").locator("tbody tr:visible, dl:visible"),
  ).toHaveCount(1);
  await expect(
    page.getByTestId("invoice-list").locator("tbody tr:visible, dl:visible"),
  ).toHaveCount(2);
  await page
    .getByText("Immutable finance audit journal", { exact: true })
    .click();
  await expect(
    page.getByText(before.journal[0]!.posting_id, { exact: true }).first(),
  ).toBeVisible();
  await layout(
    page,
    page.getByTestId("receipts-section"),
    `test-results/finance-receipts-${info.project.name}.png`,
  );
  await page
    .getByText("Immutable finance audit journal", { exact: true })
    .click();
  await page.getByRole("button", { name: "नेपाली", exact: true }).click();
  await layout(
    page,
    page.getByTestId("invoices-section"),
    `test-results/finance-invoices-${info.project.name}-ne.png`,
  );
  await page.getByRole("button", { name: "English", exact: true }).click();
  await page.goto(
    `/admin/payments?customer=${randomUUID()}&driver=${fixtureIds.driver}&trip=${f.trip}`,
  );
  await expect(
    page.getByText("No invoices match these filters.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("No payments match these filters.", { exact: true }),
  ).toBeVisible();
  await page.goto(`/admin/credit?customer=${f.customer}`);
  await expect(page.getByTestId("credit-statement")).toContainText(
    "NPR 300.50",
  );
  await expect(page.getByTestId("credit-aging")).toContainText("Not yet due");
  await expect(page.getByTestId("credit-aging")).toContainText(
    "Due unconfigured",
  );
  for (const link of ["Download PDF", "Download Excel-compatible CSV"]) {
    const href = await page
      .getByRole("link", { name: link, exact: true })
      .getAttribute("href");
    const response = await page.request.get(href!);
    expect(response.ok()).toBe(true);
    if (link === "Download PDF")
      expect((await response.body()).subarray(0, 4).toString()).toBe("%PDF");
    else expect(await response.text()).toContain("300.50");
  }
  await layout(
    page,
    page.getByTestId("credit-workspace"),
    `test-results/finance-credit-${info.project.name}.png`,
  );
  await page.goto("/admin/billing");
  const originalCompany = before.company!;
  await expect(page.getByLabel("Company name", { exact: true })).toHaveValue(
    originalCompany.name,
  );
  await page
    .getByLabel("Company name", { exact: true })
    .fill("UI billing company");
  await page.getByLabel("Phone", { exact: true }).fill("9800087654");
  await page
    .getByLabel("Reason / evidence", { exact: true })
    .fill("Verified company contact update");
  await page.getByRole("button", { name: "नेपाली", exact: true }).click();
  await expect(page.locator('input[name="name"]')).toHaveValue(
    "UI billing company",
  );
  await expect(page.locator('select[name="tax_mode"]')).toHaveValue(
    originalCompany.tax_mode,
  );
  await layout(
    page,
    page.getByTestId("billing-workspace"),
    `test-results/finance-billing-${info.project.name}-ne.png`,
  );
  await page.getByRole("button", { name: "English", exact: true }).click();
  await save(page, "Save confirmed billing settings");
  await expect(page.getByText("Record saved.", { exact: true })).toBeVisible();
  const after = await finance();
  expect(after.company?.name).toBe("UI billing company");
  expect(after.company?.tax_mode).toBe(originalCompany.tax_mode);
  expect(after.invoices).toEqual(before.invoices);
  expect(after.journal).toEqual(before.journal);
  expect(after.credit).toEqual(before.credit);
  expect(failures).toEqual([]);
});
test("close checklist, future preparation, archived history and carry-forward stay accurate", async ({
  page,
  request,
}, info) => {
  const f = await activeFixtureTrip(request, 20),
    failures = errors(page);
  page.on("dialog", (d) => d.accept());
  await delivery(f);
  const initial = await f.admin.workspace(f.trip),
    day = initial.days.find((d) => d.status === "OPEN")!,
    future = randomUUID(),
    vehicle = randomUUID();
  await f.admin.rpc("save_vehicle", {
    p_id: vehicle,
    p_plate: "FUTURE-UI",
    p_description: "Tomorrow delivery",
    p_active: true,
    p_version: 0,
    p_reason: "Prepared fixture vehicle",
    p_key: randomUUID(),
  });
  await f.admin.rpc("schedule_trip", {
    p_id: future,
    p_driver: "00000000-0000-0000-0000-000000000003",
    p_vehicle: vehicle,
    p_day: day.id,
    p_scheduled: shiftDate(day.date_label, 1),
    p_notes: "Tomorrow",
    p_key: randomUUID(),
  });
  await f.admin.rpc("load_trip", {
    p_trip: future,
    p_items: [
      { product_id: fixtureIds.jar, stock_kind: "FULL_JAR", quantity: 10 },
      {
        product_id: "00000000-0000-0000-0000-000000000012",
        stock_kind: "BOTTLE_CARTON",
        quantity: 2,
      },
    ],
    p_key: randomUUID(),
  });
  await login(page);
  await page.goto("/admin/daily-close");
  await expect(page.getByTestId("pre-close-checklist")).toContainText(
    "Closing blocked",
  );
  await expect(
    page.getByRole("button", { name: "Begin closing review", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText("FUTURE-UI · Other driver", { exact: true }),
  ).toBeVisible();
  await layout(
    page,
    page.getByTestId("pre-close-checklist"),
    `test-results/close-blocked-${info.project.name}.png`,
  );
  const counts = vehicleCounts(
    await f.admin.workspace(f.trip),
    initial.trips.find((t) => t.id === f.trip)!,
  );
  await f.driver.rpc("submit_trip", {
    p_trip: f.trip,
    p_counts: counts,
    p_key: randomUUID(),
  });
  await f.admin.rpc("reconcile_trip", {
    p_trip: f.trip,
    p_counts: counts,
    p_reason: "Physical returns verified",
    p_accept_variance: false,
    p_key: randomUUID(),
  });
  await page.reload();
  await expect(page.getByTestId("pre-close-checklist")).toContainText(
    "Ready for reconciliation review",
  );
  await expect(page.getByTestId("closing-finance")).toContainText("NPR 300.50");
  await page
    .getByRole("heading", { name: "Trip reconciliation records", exact: true })
    .click();
  await page
    .locator("details[open] details > summary")
    .filter({ hasText: "Trip #" })
    .first()
    .click();
  await expect(
    page.getByRole("link", { name: "Open trip", exact: true }),
  ).toBeVisible();
  await layout(
    page,
    page.getByTestId("closing-finance"),
    `test-results/close-finance-${info.project.name}.png`,
  );
  const stockBefore = (await f.admin.workspace()).balances;
  await save(page, "Begin closing review");
  await expect(
    page.getByRole("heading", {
      name: "Confirm daily reconciliation",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByLabel("Net cash handed over (NPR)", { exact: true })
    .fill("300.50");
  await page
    .getByLabel("Reconciliation evidence / closing notes", { exact: true })
    .fill("Cash and physical journals verified");
  for (const checkbox of await page.getByRole("checkbox").all())
    await checkbox.check();
  await save(page, "Confirm and close business day");
  await expect(
    page.getByRole("heading", { name: "No active business day", exact: true }),
  ).toBeVisible();
  const after = await f.admin.workspace();
  expect(after.balances).toEqual(stockBefore);
  expect(after.trips.find((t) => t.id === future)!.status).toBe("LOADED");
  const report = await f.admin.rpc<DayDetail>("business_day_report", {
    p_day: day.id,
  });
  expect(report.report.source).toBe("ARCHIVED");
  expect(report.report.prepared_trips?.[0]?.full_jars).toBe(10);
  await page.goto(`/admin/reports?from=${day.date_label}&to=${day.date_label}`);
  await expect(
    page.getByText(formatBusinessDate(day.date_label), { exact: true }).last(),
  ).toBeVisible();
  await expect(page.locator("#pending-jars")).toContainText("1 pending jars");
  for (const label of [
    "Export selected days to Excel-compatible CSV",
    "Export selected days to PDF",
  ]) {
    const href = await page
      .getByRole("link", { name: label, exact: true })
      .getAttribute("href");
    expect((await page.request.get(href!)).ok()).toBe(true);
  }
  await layout(
    page,
    page.getByTestId("history-workspace"),
    `test-results/finance-history-${info.project.name}.png`,
  );
  await page
    .getByRole("link", { name: "View daily report", exact: true })
    .click();
  await expect(page.getByText(/Immutable closing archive/)).toBeVisible();
  await page
    .getByRole("heading", { name: "Refilling and damaged jars", exact: true })
    .click();
  await expect(
    page.getByText("No warehouse processing recorded.", { exact: true }),
  ).toBeVisible();
  const outside = shiftDate(day.date_label, 5);
  await page.goto(`/admin/reports?from=${outside}&to=${outside}`);
  await expect(
    page.getByText("No business days match this date range.", { exact: true }),
  ).toBeVisible();
  await expect(page.locator("#pending-jars")).toContainText("1 pending jars");
  expect(
    (await f.admin.rpc<DayDetail>("business_day_report", { p_day: day.id }))
      .report,
  ).toEqual(report.report);
  expect(failures).toEqual([]);
});
test("sync shows server evidence, reported queue counts, review decisions and refresh", async ({
  page,
  request,
}, info) => {
  const f = await activeFixtureTrip(request, 20),
    failures = errors(page),
    device = randomUUID(),
    token = "a".repeat(64);
  page.on("dialog", (d) => d.accept());
  const original = await f.admin.workspace(f.trip);
  await f.driver.rpc("trusted_device_register", {
    p_device: device,
    p_token: token,
    p_name: "Fixture phone",
    p_recovery: "encrypted-fixture-envelope".repeat(6),
  });
  await f.driver.rpc("offline_register", {
    p_trip: f.trip,
    p_device: device,
    p_token: token,
  });
  await f.driver.rpc("offline_checkin", {
    p_trip: f.trip,
    p_device: device,
    p_token: token,
    p_pending: 3,
  });
  await login(page);
  await page.goto("/admin/sync");
  await expect(page.getByText("Fixture phone", { exact: true })).toBeVisible();
  await expect(page.getByTestId("sync-needs-review")).toContainText(
    "No received records need review. Unreported device records remain unknown.",
  );
  const payload = canonical({
    customer: f.customer,
    walk_name: "",
    walk_phone: "",
    items: [
      { product_id: fixtureIds.jar, full_jars: 1, empty_jars: 0, cartons: 0 },
    ],
    status: "PAID",
    received: "1.00",
    total: "150.25",
    notes: "",
    prices: [{ product_id: fixtureIds.jar, price: "150.25" }],
    custody: [{ product_id: fixtureIds.jar, quantity: 0 }],
  });
  const operation = randomUUID();
  const result = await f.driver.rpc<{ status: string }>("offline_post", {
    p_trip: f.trip,
    p_device: device,
    p_token: token,
    p_id: operation,
    p_sequence: 1,
    p_kind: "DELIVERY",
    p_occurred: new Date().toISOString(),
    p_payload: payload,
    p_fingerprint: createHash("sha256").update(payload).digest("hex"),
  });
  expect(result.status).toBe("NEEDS_REVIEW");
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByTestId("sync-needs-review")).toContainText(operation);
  await page.getByText("Review received record", { exact: true }).click();
  await page
    .getByLabel("Review action", { exact: true })
    .selectOption("REJECT");
  await page
    .getByTestId("sync-needs-review")
    .getByLabel("Reason and evidence", { exact: true })
    .fill("Preserve invalid payment evidence");
  await save(page, "Save review");
  await expect(page.getByTestId("sync-needs-review")).toContainText(
    "No received records need review.",
  );
  await page
    .getByRole("heading", { name: "Recovery audit", exact: true })
    .click();
  await expect(
    page.getByText("Preserve invalid payment evidence", { exact: true }),
  ).toBeVisible();
  expect((await f.admin.workspace(f.trip)).visits).toEqual(original.visits);
  expect((await f.admin.workspace(f.trip)).balances).toEqual(original.balances);
  await layout(
    page,
    page.getByTestId("sync-workspace"),
    `test-results/finance-sync-${info.project.name}.png`,
  );
  await page.getByRole("button", { name: "नेपाली", exact: true }).click();
  await layout(
    page,
    page.getByTestId("sync-workspace"),
    `test-results/finance-sync-${info.project.name}-ne.png`,
  );
  expect(failures).toEqual([]);
});
