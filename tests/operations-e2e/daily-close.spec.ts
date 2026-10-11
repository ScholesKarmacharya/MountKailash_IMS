import { randomUUID } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import { activeFixtureTrip, fixtureIds } from "./fixture-client";
import type {
  DayDetail,
  HistoryDay,
} from "../../src/domain/business-days/types";
async function login(page: Page, role = "admin") {
  await page.goto("/sign-in");
  await page.getByLabel("Email address").fill(`${role}@fixture.example`);
  await page.getByLabel("Password", { exact: true }).fill("fixture-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(
    role === "admin" ? /admin\/dashboard/ : /driver\/home/,
  );
}
async function save(page: Page, label: string, heading?: string) {
  const response = page.waitForResponse(
    (r) =>
      r.request().method() === "POST" &&
      r.request().headers()["next-action"] !== undefined,
  );
  await page.getByRole("button", { name: label, exact: true }).click();
  expect((await response).ok()).toBe(true);
  if (heading)
    await expect(
      page.getByRole("heading", { name: heading, exact: true }),
    ).toBeVisible();
  else
    await expect(
      page.getByText("Record saved.", { exact: true }).last(),
    ).toBeVisible();
}
test("closing blockers, refill, cash review, archive exports and next-day carry-forward work in the browser", async ({
  page,
  request,
}) => {
  page.on("dialog", (d) => d.accept());
  const { admin, driver, customer, trip } = await activeFixtureTrip(request);
  const day = (await admin.workspace()).days[0]!.id;
  const detail = (id = day) =>
    admin.rpc<DayDetail>("business_day_report", { p_day: id });
  await login(page);
  await page.goto("/admin/daily-close");
  await expect(page.getByRole("link", { name: /is ACTIVE/ })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Begin closing review", exact: true }),
  ).toHaveCount(0);
  await driver.rpc("post_trip_visit", {
    p_trip: trip,
    p_customer: customer,
    p_walk_name: "",
    p_walk_phone: "",
    p_items: [
      { product_id: fixtureIds.jar, full_jars: 80, empty_jars: 65, cartons: 0 },
    ],
    p_payment: { selection: "CASH" },
    p_notes: "",
    p_key: randomUUID(),
  });
  const counts = [
    { product_id: fixtureIds.jar, stock_kind: "FULL_JAR", quantity: 20 },
    { product_id: fixtureIds.jar, stock_kind: "EMPTY_JAR", quantity: 65 },
  ];
  await driver.rpc("submit_trip", {
    p_trip: trip,
    p_counts: counts,
    p_key: randomUUID(),
  });
  await admin.rpc("reconcile_trip", {
    p_trip: trip,
    p_counts: counts,
    p_reason: "Physical returns checked",
    p_accept_variance: false,
    p_key: randomUUID(),
  });
  await page.goto("/admin/refilling");
  const refill = page.locator("form").filter({
    has: page.locator('input[name="operation"][value="day:REFILL"]'),
  });
  await refill
    .getByLabel("Jar product", { exact: true })
    .selectOption(fixtureIds.jar);
  await refill
    .getByLabel("Eligible empties successfully refilled", { exact: true })
    .fill("60");
  await refill
    .getByLabel("Processing reason / inspection notes", { exact: true })
    .fill("Completed inspected refill batch");
  await save(page, "Record completed refill");
  await page.reload();
  const damage = page.locator("form").filter({
    has: page.locator('input[name="operation"][value="day:DAMAGE"]'),
  });
  await damage
    .getByLabel("Jar product", { exact: true })
    .selectOption(fixtureIds.jar);
  await damage.getByLabel("Damaged jar quantity", { exact: true }).fill("5");
  await damage
    .getByLabel("Processing reason / inspection notes", { exact: true })
    .fill("Five rejected cracked jars");
  await save(page, "Record damaged jars");
  await page.goto("/admin/daily-close");
  await expect(page.getByText(/No critical blockers detected/)).toBeVisible();
  await save(page, "Begin closing review", "Confirm daily reconciliation");
  await expect
    .poll(async () => (await detail()).report.day.status)
    .toBe("CLOSING_REVIEW");
  await page.reload();
  await page
    .getByLabel("Net cash handed over (NPR)", { exact: true })
    .fill("1");
  await page
    .getByLabel("Reconciliation evidence / closing notes", { exact: true })
    .fill("Counted handover and checked receipts");
  for (const checkbox of await page.getByRole("checkbox").all())
    await checkbox.check();
  await page
    .getByRole("button", {
      name: "Confirm and close business day",
      exact: true,
    })
    .click();
  await expect(
    page
      .locator("form")
      .filter({
        has: page.locator('input[name="operation"][value="day:CLOSE"]'),
      })
      .getByRole("alert"),
  ).toContainText("does not match");
  expect((await detail()).report.day.status).toBe("CLOSING_REVIEW");
  await page
    .getByLabel("Net cash handed over (NPR)", { exact: true })
    .fill("12020");
  await save(page, "Confirm and close business day", "No active business day");
  await expect
    .poll(async () => (await detail()).report.source)
    .toBe("ARCHIVED");
  await page.goto(`/admin/reports/${day}`);
  await expect(page.getByText(/Immutable closing archive/)).toBeVisible();
  const archived = (await detail()).report;
  const csv = await page.request.get(`/api/business-days/${day}/csv`);
  expect(csv.ok()).toBe(true);
  expect(csv.headers()["cache-control"]).toBe("private, no-store");
  expect(await csv.text()).toContain('"Sales excluding tax",,12020.00');
  const pdf = await page.request.get(`/api/business-days/${day}/pdf`);
  expect(pdf.ok()).toBe(true);
  expect((await pdf.body()).subarray(0, 4).toString()).toBe("%PDF");
  const range = await page.request.get(
    `/api/business-days/export?from=${archived.day.date_label}&to=${archived.day.date_label}&format=csv`,
  );
  expect(range.ok()).toBe(true);
  expect(await range.text()).toBe(await csv.text());
  const rangePdf = await page.request.get(
    `/api/business-days/export?from=${archived.day.date_label}&to=${archived.day.date_label}&format=pdf`,
  );
  expect(rangePdf.ok()).toBe(true);
  expect(rangePdf.headers()["cache-control"]).toBe("private, no-store");
  expect((await rangePdf.body()).subarray(0, 4).toString()).toBe("%PDF");
  await page.goto("/admin/reports");
  await page.getByLabel("From date", { exact: true }).fill("1990-01-01");
  await page.getByLabel("To date", { exact: true }).fill("1990-01-02");
  await page
    .getByRole("button", { name: "Filter history", exact: true })
    .click();
  await expect(
    page.getByText("No business days match this date range."),
  ).toBeVisible();
  await page.goto("/admin/daily-close");
  await page
    .getByRole("button", { name: "Open business day", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (
          await admin.rpc<HistoryDay[]>("business_day_history", {
            p_from: null,
            p_to: null,
          })
        ).filter((d) => d.status === "OPEN").length,
    )
    .toBe(1);
  await expect(
    page.getByRole("button", { name: "Begin closing review", exact: true }),
  ).toBeVisible();
  const days = await admin.rpc<HistoryDay[]>("business_day_history", {
    p_from: null,
    p_to: null,
  });
  const next = days.find((d) => d.status === "OPEN")!;
  expect(next.id).not.toBe(day);
  const current = (await detail(next.id)).report;
  expect(current.totals).toMatchObject({
    sales: "0",
    collections: "0",
    trips: 0,
  });
  expect(
    current.stock.find(
      (s) => s.stock_kind === "FULL_JAR" && s.location_kind === "WAREHOUSE",
    )!.opening,
  ).toBe(80);
  await page.goto(`/admin/reports/${day}`);
  expect((await detail()).report).toEqual(archived);
  await page.reload();
  await expect(page.getByText(/Immutable closing archive/)).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/sign-in/);
  await login(page, "driver");
  await page.goto("/admin/daily-close");
  await expect(page).toHaveURL(/driver\/home/);
  const denied = await page.request.get(`/api/business-days/${day}/csv`, {
    maxRedirects: 0,
  });
  expect([303, 307]).toContain(denied.status());
  const deniedRange = await page.request.get(
    `/api/business-days/export?format=pdf`,
    { maxRedirects: 0 },
  );
  expect([303, 307]).toContain(deniedRange.status());
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/sign-in/);
  await login(page);
  await page.goto(`/admin/reports/${day}`);
  await expect(page.getByText(/Immutable closing archive/)).toBeVisible();
  expect((await detail()).report).toEqual(archived);
});
