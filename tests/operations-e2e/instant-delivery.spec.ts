import { test, expect, type Page } from "@playwright/test";
import { activeFixtureTrip, fixtureIds } from "./fixture-client";
async function login(page: Page, role = "driver") {
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "English", exact: true }).click();
  await page.getByLabel("Email address").fill(`${role}@fixture.example`);
  await page.getByLabel("Password", { exact: true }).fill("fixture-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(
    role === "driver" ? /driver\/home/ : /admin\/dashboard/,
  );
  await page.getByRole("button", { name: "English", exact: true }).click();
}
async function fill(
  page: Page,
  name: string,
  empty: number,
  credit = false,
  screenshot?: string,
) {
  await page.getByLabel("Customer or Event Name", { exact: true }).fill(name);
  await page.getByLabel("Phone Number", { exact: true }).fill("9801234567");
  await page
    .getByLabel("Delivery Location", { exact: true })
    .fill("Patan event hall");
  await page.getByLabel("Jars Delivered", { exact: true }).fill("20");
  await page
    .getByLabel("Empty Jars Collected", { exact: true })
    .fill(String(empty));
  if (credit)
    await page.getByRole("button", { name: "Credit", exact: true }).click();
  await expect(
    page.getByRole("button", { name: credit ? "Credit" : "Paid", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  if (screenshot)
    await page
      .getByTestId("instant-form")
      .screenshot({ path: screenshot, scale: "css", animations: "disabled" });
  await page
    .getByRole("button", { name: "Review Instant Delivery", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Save Instant Delivery", exact: true })
    .click();
}
test("quick event deliveries reuse sale/return/payment ledgers, separate admin cards, conversion and phone layouts", async ({
  page,
  request,
  browser,
}, testInfo) => {
  page.on("dialog", (d) => d.accept());
  const f = await activeFixtureTrip(request);
  await login(page);
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "Instant Delivery", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Instant Delivery", exact: true }),
  ).toBeVisible();
  await fill(page, `Completed Party ${"A".repeat(80)}`, 20);
  const cards = page.getByTestId("instant-card");
  await expect(cards).toHaveCount(1);
  await expect(cards).toContainText("Completed");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole("button", { name: "Continue with updated data", exact: true })
    .click();
  await fill(
    page,
    "Wedding Credit",
    15,
    true,
    `test-results/instant-form-${testInfo.project.name}.png`,
  );
  await expect(cards).toHaveCount(2);
  const w = await f.admin.workspace(f.trip);
  expect(w.items.reduce((n, i) => n + i.full_jars, 0)).toBe(40);
  expect(w.custody.reduce((n, c) => n + c.quantity, 0)).toBe(5);
  const adminContext = await browser.newContext({
    baseURL: testInfo.project.use.baseURL,
    viewport: testInfo.project.use.viewport,
  });
  const adminPage = await adminContext.newPage();
  adminPage.on("dialog", (d) => d.accept());
  try {
    await login(adminPage, "admin");
    await adminPage
      .getByRole("navigation")
      .getByRole("link", { name: "Instant Deliveries", exact: true })
      .click();
    await expect(adminPage.getByTestId("Total Instant Deliveries")).toHaveText(
      "2",
    );
    await expect(adminPage.getByTestId("Jars Pending Return")).toHaveText("5");
    await expect(adminPage.getByTestId("Outstanding Credit")).toHaveText(
      "NPR 3,005.00",
    );
    const statusFilter = adminPage.getByLabel("Delivery status", {
      exact: true,
    });
    for (const filter of ["jars", "payments", "completed"]) {
      await statusFilter.selectOption(filter);
      await expect(adminPage.getByTestId("instant-card")).toHaveCount(1);
    }
    await statusFilter.selectOption("today");
    await expect(adminPage.getByTestId("instant-card")).toHaveCount(2);
    await statusFilter.selectOption("all");
    await adminPage
      .getByLabel("Driver", { exact: true })
      .selectOption(fixtureIds.driver);
    await adminPage
      .getByLabel("Vehicle", { exact: true })
      .selectOption(w.trips[0]!.vehicle_id);
    await adminPage
      .getByLabel("Search events or phone", { exact: true })
      .fill("Wedding");
    await expect(adminPage.getByTestId("instant-card")).toHaveCount(1);
    await adminPage
      .getByLabel("Search events or phone", { exact: true })
      .fill("");
    await adminPage.screenshot({
      path: `test-results/instant-summary-${testInfo.project.name}.png`,
      fullPage: true,
    });
    const event = page
      .getByTestId("instant-card")
      .filter({ hasText: "Wedding Credit" });
    await event.click({ position: { x: 24, y: 24 } });
    await expect(
      page.getByRole("button", {
        name: "Back to Instant Deliveries",
        exact: true,
      }),
    ).toBeFocused();
    await page
      .getByLabel("20L test jar · Empty Jars Collected", { exact: true })
      .fill("5");
    await page
      .getByRole("button", { name: "Collect Empty Jars", exact: true })
      .click();
    await expect(page.getByTestId("instant-history")).toContainText(
      "Pending Payment",
    );
    await page
      .getByLabel("Credit amount received (NPR)", { exact: true })
      .fill("3005.00");
    await page
      .getByRole("button", { name: "Collect outstanding credit", exact: true })
      .click();
    await expect(page.getByTestId("instant-history")).toContainText(
      "Completed",
    );
    const after = await f.admin.workspace(f.trip);
    expect(after.items.reduce((n, i) => n + i.full_jars, 0)).toBe(40);
    expect(after.custody.every((c) => c.quantity === 0)).toBe(true);
    const finance = await f.admin.rpc<{
      invoices: unknown[];
      payments: unknown[];
    }>("finance_workspace", {});
    expect(finance.invoices).toHaveLength(2);
    expect(finance.payments).toHaveLength(2);
    await adminPage.reload();
    const adminCard = adminPage
      .getByTestId("instant-card")
      .filter({ hasText: "Wedding Credit" });
    await adminCard
      .getByRole("link", { name: "Open Instant Delivery", exact: true })
      .click();
    await expect(
      adminPage
        .getByTestId("instant-history")
        .getByRole("link", { name: "View invoice", exact: true }),
    ).toBeVisible();
    await expect(
      adminPage
        .getByTestId("instant-history")
        .getByRole("link", { name: "View receipt", exact: true }),
    ).toHaveCount(1);
    await adminPage
      .getByLabel("Reason", { exact: true })
      .fill("Now a regular customer; keep original history");
    await adminPage
      .getByRole("button", { name: "Convert to Regular Customer", exact: true })
      .click();
    await expect(
      adminPage.getByText("Saved to the database.", { exact: true }).first(),
    ).toBeVisible();
    const records = await f.admin.rpc<{
      records: { is_one_time: boolean; event_name: string; pending: number }[];
    }>("instant_workspace", {});
    expect(
      records.records.find((r) => r.event_name === "Wedding Credit"),
    ).toMatchObject({ is_one_time: false, pending: 0 });
    await page.getByRole("button", { name: "नेपाली", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "तत्काल डेलिभरी", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `test-results/instant-${testInfo.project.name}.png`,
      fullPage: true,
    });
    await adminPage.screenshot({
      path: `test-results/instant-admin-${testInfo.project.name}.png`,
      fullPage: true,
    });
    if (testInfo.project.name === "mobile-operations") {
      await page.getByRole("button", { name: "English", exact: true }).click();
      await page
        .getByRole("button", {
          name: "Back to Instant Deliveries",
          exact: true,
        })
        .click();
      await page.setViewportSize({ width: 360, height: 800 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: "test-results/instant-360.png",
        fullPage: true,
      });
    }
    const location = after.vehicles.find(
      (v) => v.id === after.trips[0]!.vehicle_id,
    )!.location_id;
    expect(
      after.balances.find(
        (b) =>
          b.location_id === location &&
          b.product_id === fixtureIds.jar &&
          b.stock_kind === "EMPTY_JAR",
      )!.quantity,
    ).toBe(40);
  } finally {
    await adminContext.close();
  }
});

test("carton-only instant orders use available stock, a one-time reference and ordinary paid pricing", async ({
  page,
  request,
}, testInfo) => {
  page.on("dialog", (d) => d.accept());
  const f = await activeFixtureTrip(request, 0, 10);
  await login(page);
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "Instant Delivery", exact: true })
    .click();
  await expect(page.getByTestId("instant-form")).toBeVisible();
  await expect(page.getByLabel("Jars Delivered", { exact: true })).toHaveCount(
    0,
  );
  await expect(
    page.getByLabel("Empty Jars Collected", { exact: true }),
  ).toHaveCount(0);
  await page
    .getByLabel("Customer or Event Name", { exact: true })
    .fill("One-day carton order");
  await page
    .getByLabel("Delivery Location", { exact: true })
    .fill("Lakeside shop");
  await page.getByLabel("Cartons Delivered", { exact: true }).fill("3");
  await page
    .getByRole("button", { name: "Review Instant Delivery", exact: true })
    .click();
  await expect(
    page.getByTestId("instant-form").getByRole("status"),
  ).toContainText("Cartons Delivered: 3");
  await page
    .getByRole("button", { name: "Save Instant Delivery", exact: true })
    .click();
  const card = page.getByTestId("instant-card");
  await expect(card).toContainText("Test water carton");
  await expect(card).toContainText("All Returned");
  await expect(card).toContainText("Paid");
  const w = await f.admin.workspace(f.trip),
    location = w.vehicles.find(
      (v) => v.id === w.trips[0]!.vehicle_id,
    )!.location_id;
  expect(
    w.balances.find(
      (b) => b.location_id === location && b.stock_kind === "BOTTLE_CARTON",
    )!.quantity,
  ).toBe(7);
  expect(w.custody.every((c) => c.quantity === 0)).toBe(true);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `test-results/instant-cartons-${testInfo.project.name}.png`,
    fullPage: true,
    scale: "css",
  });
});

test("no active trip blocks the form with the warehouse message", async ({
  page,
  request,
}) => {
  expect((await request.post("http://127.0.0.1:17777/reset")).ok()).toBe(true);
  await login(page);
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "Instant Delivery", exact: true })
    .click();
  await expect(
    page.getByText("No active delivery trip. Please contact the warehouse.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByTestId("instant-form")).toHaveCount(0);
});

test("a schema capability failure is not mislabeled as a missing active trip", async ({
  page,
  request,
}) => {
  await activeFixtureTrip(request);
  await page.route("**/api/driver/workspace?*", async (route) => {
    const response = await route.fetch(),
      data = await response.json();
    await route.fulfill({
      response,
      json: {
        ...data,
        instant: {
          available: false,
          records: [],
          unavailable_reason: "schema",
        },
      },
    });
  });
  await login(page);
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "Instant Delivery", exact: true })
    .click();
  await expect(
    page.getByText(
      "Instant Delivery requires a database update. Contact the admin.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page.getByText("No active delivery trip. Please contact the warehouse.", {
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(page.getByTestId("instant-form")).toHaveCount(0);
});

test("multiple eligible trip responses require a choice before entry", async ({
  page,
  request,
}) => {
  const f = await activeFixtureTrip(request);
  await page.route("**/api/driver/workspace?*", async (route) => {
    const response = await route.fetch(),
      data = await response.json();
    if (new URL(route.request().url()).searchParams.has("trip")) {
      await route.fulfill({ response });
      return;
    }
    const other = {
      ...data.trip,
      id: "10000000-0000-4000-8000-000000000002",
      trip_number: 2,
      plate_number: "SECOND-TEST",
    };
    await route.fulfill({
      response,
      json: {
        ...data,
        eligibleTrips: [data.trip, other],
        tripChoiceRequired: true,
      },
    });
  });
  await login(page);
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "Instant Delivery", exact: true })
    .click();
  const chooser = page.getByTestId("instant-trip-chooser");
  await expect(chooser).toBeVisible();
  await expect(chooser.getByRole("link")).toHaveCount(2);
  await expect(page.getByTestId("instant-form")).toHaveCount(0);
  await expect(
    page.getByText("No active delivery trip. Please contact the warehouse.", {
      exact: true,
    }),
  ).toHaveCount(0);
  await chooser
    .locator(`a[href='/driver/instant-delivery?trip=${f.trip}']`)
    .click();
  await expect(page.getByTestId("instant-form")).toBeVisible();
});
