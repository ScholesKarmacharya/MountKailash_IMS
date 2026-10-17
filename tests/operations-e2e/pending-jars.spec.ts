import { saveDriverRecord } from "./fixture-client";
import { randomUUID } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import {
  activeFixtureTrip,
  fixtureClient,
  fixtureIds,
  openAdminMenuForSignOut,
} from "./fixture-client";
import type { DeliveryCustomerContext } from "../../src/domain/operations/customer-context";
import type { FinanceWorkspace } from "../../src/domain/finance/types";
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
async function record(page: Page, full: number, empty: number) {
  await expect(page.getByText("Offline ready", { exact: true })).toBeVisible({
    timeout: 30000,
  });
  await page.getByLabel("Jars Delivered", { exact: true }).fill(String(full));
  await page
    .getByLabel("Empty Jars Returned", { exact: true })
    .fill(String(empty));
  if (full > 0)
    await page.getByRole("button", { name: "Credit", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Review delivery", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Review delivery", exact: true })
    .click();
  await saveDriverRecord(page);
}
async function logout(page: Page) {
  await openAdminMenuForSignOut(page);
  await page.getByRole("button", { name: "Sign Out", exact: true }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
}
test("FIFO pending dates, return-only collection and admin report persist through refresh and login", async ({
  page,
  request,
}) => {
  const { admin, driver, trip, customer } = await activeFixtureTrip(request);
  const context = () =>
    driver.rpc<DeliveryCustomerContext>("delivery_customer_context", {
      p_trip: trip,
      p_customer: customer,
    });
  await login(page);
  await page.goto(`/driver/delivery?customer=${customer}`);
  await page
    .getByRole("button", { name: "Refresh customer", exact: true })
    .click();
  await record(page, 20, 15);
  await expect
    .poll(async () => (await context()).pending_jars?.[0]?.pending)
    .toBe(5);
  await page.reload();
  await page
    .getByRole("button", { name: "Refresh customer", exact: true })
    .click();
  await page
    .getByText("Customer credit and jar history", { exact: true })
    .click();
  await expect(page.getByText("5 pending jars", { exact: true })).toBeVisible();
  await record(page, 10, 12);
  await expect
    .poll(async () => (await context()).pending_jars?.[0]?.pending)
    .toBe(3);
  const pending = (await context()).pending_jars!;
  await page.goto("/driver/home");
  // The compact Home shows physical stock. Visit counters remain authoritative
  // in the trip journal and the individual history cards.
  const visits = await admin.workspace(trip);
  expect(visits.visits).toHaveLength(2);
  expect(new Set(visits.items.map((i) => i.visit_id)).size).toBe(2);
  await page.goto("/driver/sales");
  await expect(page.getByTestId("driver-history-card")).toHaveCount(2);
  await page.goto("/driver/pending-jars");
  await expect(page.getByTestId("driver-pending-total")).toHaveText("3");
  await logout(page);
  await login(page);
  await page.goto("/driver/pending-jars");
  await expect(page.getByTestId("driver-pending-total")).toHaveText("3");
  expect((await context()).pending_jars).toEqual(pending);
  await page.goto(`/driver/delivery?customer=${customer}`);
  await page
    .getByRole("button", { name: "Refresh customer", exact: true })
    .click();
  await record(page, 0, 3);
  await expect.poll(async () => (await context()).pending_jars?.length).toBe(0);
  const finance = await admin.rpc<FinanceWorkspace>("finance_workspace", {});
  expect(finance.invoices).toHaveLength(2);
  expect(finance.sales).toHaveLength(2);
  await page.goto("/driver/home");
  const afterReturn = await admin.workspace(trip);
  expect(afterReturn.visits).toHaveLength(3);
  expect(
    new Set(
      afterReturn.items
        .filter((i) => i.full_jars > 0 || i.cartons > 0)
        .map((i) => i.visit_id),
    ).size,
  ).toBe(2);
  await page.goto("/driver/pending-jars");
  await page.goto("/driver/pending-jars");
  await expect(
    page.getByText("No pending jars.", { exact: true }),
  ).toBeVisible();
  await page.goto(`/driver/trips/${trip}`);
  await page.reload();
  await expect(
    page.getByText("Empty-return visit; no new sale or invoice", {
      exact: true,
    }),
  ).toBeVisible();
  await logout(page);
  await login(page, "admin");
  await page.goto("/admin/reports");
  await expect(
    page.getByRole("heading", {
      name: "Current pending jars (carry-forward)",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("No pending jars.", { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("two drivers retain a simultaneous customer conflict, resolve it with audited admin review and remain isolated", async ({
  page,
  request,
  browser,
}) => {
  const { admin, trip, customer } = await activeFixtureTrip(request, 50);
  const other = await fixtureClient(request, "other"),
    vehicle2 = randomUUID(),
    trip2 = randomUUID();
  await admin.rpc("save_vehicle", {
    p_id: vehicle2,
    p_plate: "SECOND-VEHICLE",
    p_description: "",
    p_active: true,
    p_version: 0,
    p_reason: "Disposable parallel test",
    p_key: randomUUID(),
  });
  const day = (await admin.workspace()).days[0]!.id;
  await admin.rpc("create_trip", {
    p_id: trip2,
    p_driver: "00000000-0000-0000-0000-000000000003",
    p_vehicle: vehicle2,
    p_day: day,
    p_customers: [],
    p_notes: "",
    p_key: randomUUID(),
  });
  await admin.rpc("load_trip", {
    p_trip: trip2,
    p_items: [
      { product_id: fixtureIds.jar, stock_kind: "FULL_JAR", quantity: 50 },
    ],
    p_key: randomUUID(),
  });
  await other.rpc("transition_trip", {
    p_trip: trip2,
    p_action: "START",
    p_reason: "",
    p_key: randomUUID(),
  });
  const secondContext = await browser.newContext({
    baseURL: "http://127.0.0.1:3002",
    viewport: page.viewportSize()!,
  });
  try {
    const second = await secondContext.newPage();
    await Promise.all([login(page), login(second, "other")]);
    await Promise.all([
      page.goto(`/driver/trips/${trip}`),
      second.goto(`/driver/trips/${trip2}`),
    ]);
    await Promise.all([
      page
        .getByRole("main")
        .getByRole("link", { name: "New Sale", exact: true })
        .click(),
      second
        .getByRole("main")
        .getByRole("link", { name: "New Sale", exact: true })
        .click(),
    ]);
    await Promise.all([
      page
        .getByRole("button", { name: "Refresh customer", exact: true })
        .click(),
      second
        .getByRole("button", { name: "Refresh customer", exact: true })
        .click(),
    ]);
    await Promise.all(
      [page, second].map((p) =>
        expect(p.getByText("Offline ready", { exact: true })).toBeVisible({
          timeout: 30000,
        }),
      ),
    );
    // Freeze both phones' original balance before either upload. Without this
    // barrier the second phone may correctly refresh after the first commits.
    await Promise.all([
      page.context().setOffline(true),
      secondContext.setOffline(true),
    ]);
    await Promise.all([record(page, 20, 15), record(second, 10, 7)]);
    expect((await admin.workspace(trip)).visits).toHaveLength(0);
    expect((await admin.workspace(trip2)).visits).toHaveLength(0);
    await Promise.all([
      page.context().setOffline(false),
      secondContext.setOffline(false),
    ]);
    const sync = () =>
      admin.rpc<{
        operations: {
          id: string;
          status: string;
          kind: string;
          payload: string;
          message: string;
        }[];
        reviews: {
          operation_id: string;
          action: string;
          details: { original_payload: string };
        }[];
      }>("offline_admin_workspace", {});
    // Both phones read the same original custody. Exactly one may commit;
    // the other must retain its original operation for an explicit FIFO review.
    await expect
      .poll(
        async () =>
          (await sync()).operations.filter((o) => o.status === "NEEDS_REVIEW")
            .length,
      )
      .toBe(1);
    const conflict = (await sync()).operations.find(
      (o) => o.status === "NEEDS_REVIEW",
    )!;
    expect(conflict.message).toContain("Customer jar balance changed");
    expect(
      (await admin.workspace(trip)).visits.length +
        (await admin.workspace(trip2)).visits.length,
    ).toBe(1);
    await admin.rpc("offline_admin_review", {
      p_id: conflict.id,
      p_action: "REBASE_CUSTODY",
      p_customer: null,
      p_reason:
        "Reviewed both disposable delivery slips and physical return counts; allocate FIFO against current custody",
      p_key: randomUUID(),
    });
    await Promise.all(
      [page, second].map((p) =>
        p.evaluate(() => window.dispatchEvent(new Event("focus"))),
      ),
    );
    await expect
      .poll(async () => (await admin.workspace(trip)).visits.length)
      .toBe(1);
    await expect
      .poll(async () => (await admin.workspace(trip2)).visits.length)
      .toBe(1);
    expect((await sync()).reviews).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operation_id: conflict.id,
          action: "REBASE_CUSTODY",
          details: expect.objectContaining({
            original_payload: conflict.payload,
          }),
        }),
      ]),
    );
    const firstWorkspace = await admin.workspace(trip),
      secondWorkspace = await admin.workspace(trip2);
    const firstLocation = firstWorkspace.vehicles.find(
      (v) => v.id === firstWorkspace.trips[0]!.vehicle_id,
    )!.location_id;
    const secondLocation = secondWorkspace.vehicles.find(
      (v) => v.id === vehicle2,
    )!.location_id;
    expect(
      firstWorkspace.balances.find(
        (b) => b.stock_kind === "FULL_JAR" && b.location_id === firstLocation,
      )?.quantity,
    ).toBe(30);
    expect(
      secondWorkspace.balances.find(
        (b) => b.stock_kind === "FULL_JAR" && b.location_id === secondLocation,
      )?.quantity,
    ).toBe(40);
    const pending = await admin.rpc<{ rows: { pending: number }[] }>(
      "pending_jar_workspace",
      { p_trip: null, p_customer: customer },
    );
    expect(pending.rows.reduce((n, r) => n + r.pending, 0)).toBe(8);
    await page.goto(`/driver/trips/${trip2}`);
    await expect(
      page.getByRole("heading", { name: "Page not found", exact: true }),
    ).toBeVisible();
    await second.goto(`/driver/trips/${trip}`);
    await expect(
      second.getByRole("heading", { name: "Page not found", exact: true }),
    ).toBeVisible();
  } finally {
    await secondContext.close();
  }
});
