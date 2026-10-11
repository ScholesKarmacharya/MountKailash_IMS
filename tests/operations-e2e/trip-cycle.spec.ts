import { expect, test, type Page } from "@playwright/test";
import { vehicleCounts } from "../../src/domain/operations/types";
import { fixtureClient } from "./fixture-client";
async function login(page: Page, role = "admin") {
  await page.goto("/sign-in");
  await page.getByLabel("Email address").fill(`${role}@fixture.example`);
  await page.getByLabel("Password", { exact: true }).fill("fixture-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(
    role === "admin" ? /admin\/dashboard/ : /driver\/home/,
  );
}
async function save(page: Page, label: string) {
  // A previous operation's toast may still be visible. Wait for this action's
  // action response before checking success. Flight may keep streaming the
  // re-rendered page; persistence assertions below read the actual database.
  const action = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      !!response.request().headers()["next-action"],
  );
  await page.getByRole("button", { name: label, exact: true }).click();
  const response = await action;
  expect(response.ok()).toBe(true);
  await expect(
    page.getByText("Saved to the database.", { exact: true }),
  ).toBeVisible();
}
async function updated(page: Page, reload = false) {
  if (reload)
    await page
      .getByRole("button", { name: "Continue with updated data", exact: true })
      .click();
  await page.waitForLoadState("domcontentloaded");
}
test("real SQL physical trip cycle through admin and mobile driver screens", async ({
  page,
  request,
}) => {
  await request.post("http://127.0.0.1:17777/reset");
  const admin = await fixtureClient(request);
  const driver = await fixtureClient(request, "driver");
  page.on("dialog", (d) => d.accept());
  await login(page);
  for (const heading of ["Customers", "Vehicles", "Drivers", "Trips"]) {
    await page.goto(`/admin/${heading.toLowerCase()}`);
    await expect(
      page.getByRole("heading", { name: heading, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(/Sprint 2 migrations are required/),
    ).toHaveCount(0);
  }
  await page.goto("/admin/customers");
  await page
    .getByLabel("Customer name", { exact: true })
    .fill("Browser Customer");
  await page.getByLabel("Shop / business").fill("Browser Shop");
  await page.getByLabel("Reason for this change").fill("Browser test customer");
  await save(page, "Create customer");
  await page.goto("/admin/vehicles");
  await page.getByLabel("Number plate").fill("TEST-BROWSER");
  await page.getByLabel("Reason for this change").fill("Browser test vehicle");
  await save(page, "Register vehicle");
  await page.goto("/admin/trips");
  await page
    .getByLabel("Driver", { exact: true })
    .selectOption({ label: "Fixture driver" });
  await page
    .getByLabel("Vehicle", { exact: true })
    .selectOption({ label: "TEST-BROWSER" });
  await page.getByRole("checkbox", { name: /Browser Customer/ }).check();
  await save(page, "Create draft trip");
  await page
    .getByRole("link", { name: "Open saved trip", exact: true })
    .click();
  await expect(page).toHaveURL(/\/admin\/trips\/[0-9a-f-]+$/);
  const tripPath = new URL(page.url()).pathname;
  const tripId = tripPath.split("/").at(-1)!;
  await page
    .getByRole("checkbox", { name: "20L test jar", exact: true })
    .check();
  await page.getByLabel("20L test jar load", { exact: true }).fill("100");
  await page
    .getByRole("checkbox", { name: "Test water carton", exact: true })
    .check();
  await page.getByLabel("Test water carton load", { exact: true }).fill("10");
  await save(page, "Confirm warehouse loading");
  await updated(page);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/sign-in/);
  await login(page, "driver");
  await save(page, "Start trip");
  await page.getByRole("link", { name: "View trip / return counts" }).click();
  let visitCount = 0;
  for (const [full, empty] of [
    [40, 30],
    [40, 35],
  ] as const) {
    await page.getByRole("button", { name: /Browser Customer/ }).click();
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
      .getByRole("button", {
        name: "Decrease Full jars delivered",
        exact: true,
      })
      .click();
    await page
      .getByLabel("Full jars delivered", { exact: true })
      .fill(String(full));
    await page
      .getByLabel("Empty jars collected", { exact: true })
      .fill(String(empty));
    await page
      .getByRole("button", {
        name: "Increase Empty jars collected",
        exact: true,
      })
      .click();
    await expect(
      page.getByLabel("Empty jars collected", { exact: true }),
    ).toHaveValue(String(empty + 1));
    await page
      .getByRole("button", {
        name: "Decrease Empty jars collected",
        exact: true,
      })
      .click();
    await expect(
      page.getByLabel("Empty jars collected", { exact: true }),
    ).toHaveValue(String(empty));
    await page
      .getByRole("button", { name: "Review delivery", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Correct quantities", exact: true })
      .click();
    await expect(
      page.getByLabel("Full jars delivered", { exact: true }),
    ).toHaveValue(String(full));
    await page
      .getByRole("button", { name: "Review delivery", exact: true })
      .click();
    const form = page
      .locator("form")
      .filter({ has: page.locator('input[name="operation"][value="visit"]') });
    const retry = {
      p_trip: tripId,
      p_customer: await form.locator('input[name="customer"]').inputValue(),
      p_walk_name: "",
      p_walk_phone: "",
      p_items: JSON.parse(
        await form.locator('input[name="items"]').inputValue(),
      ),
      p_payment: {
        selection: "CASH",
        reported_amount: null,
        reference: "",
        payments: JSON.parse(
          await form.locator('input[name="finance_payments"]').inputValue(),
        ),
      },
      p_notes: "",
      p_key: await form.locator('input[name="key"]').inputValue(),
    };
    await save(page, "Save confirmed delivery");
    await expect
      .poll(async () => (await admin.workspace(tripId)).visits.length)
      .toBe(++visitCount);
    const saved = await admin.workspace(tripId);
    const visitId = await driver.rpc<string>("post_trip_visit", retry);
    expect(saved.visits.map((v) => v.id)).toContain(visitId);
    const replayed = await admin.workspace(tripId);
    expect(replayed.visits).toHaveLength(saved.visits.length);
    expect(replayed.movements).toHaveLength(saved.movements.length);
    await updated(page, true);
  }
  await expect(
    page.getByText("Browser Customer · 2 visits", { exact: true }),
  ).toBeVisible();
  const fullInput = page.getByLabel("Full jars delivered", { exact: true });
  await fullInput.fill("21");
  await expect(fullInput).not.toHaveValue("21");
  await expect(
    page.getByLabel("Full jars counted", { exact: true }),
  ).toHaveValue("20");
  await expect(
    page.getByLabel("Empty jars counted", { exact: true }),
  ).toHaveValue("65");
  const beforeSubmission = await admin.workspace(tripId);
  await save(page, "Submit trip counts");
  await updated(page);
  await expect(
    page.getByText("Awaiting warehouse verification", { exact: true }),
  ).toBeVisible();
  const submitted = await admin.workspace(tripId);
  expect(submitted.trips[0]!.status).toBe("SUBMITTED");
  expect(submitted.movements).toHaveLength(beforeSubmission.movements.length);
  expect(submitted.balances).toEqual(beforeSubmission.balances);
  expect(submitted.declarations).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ stock_kind: "FULL_JAR", quantity: 20 }),
      expect.objectContaining({ stock_kind: "EMPTY_JAR", quantity: 65 }),
    ]),
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/sign-in/);
  await login(page, "other");
  const other = await fixtureClient(request, "other");
  expect((await other.workspace()).trips).toHaveLength(0);
  await page.goto(tripPath.replace("/admin/", "/driver/"));
  await expect(page.getByRole("heading", { name: /not found/i })).toBeVisible();
  await page.goto("/admin/trips");
  await expect(page).toHaveURL(/driver\/home/);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/sign-in/);
  await login(page);
  await page.goto(tripPath);
  await page
    .getByLabel("Verification / discrepancy reason", { exact: true })
    .fill("Counts physically verified");
  await save(page, "Post physical verification");
  await updated(page);
  await expect(
    page.getByRole("heading", { name: "Physical trip closed", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText("Browser Customer · 2 visits", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/TRIP RETURN/)).toHaveCount(3);
  const closed = await admin.workspace(tripId);
  expect(closed.trips[0]!.status).toBe("CLOSED");
  expect(
    vehicleCounts(closed, closed.trips[0]!).every((c) => c.quantity === 0),
  ).toBe(true);
  expect(
    closed.movements.filter((m) => m.movement_type === "TRIP_RETURN"),
  ).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ stock_kind: "FULL_JAR", quantity: 20 }),
      expect.objectContaining({ stock_kind: "EMPTY_JAR", quantity: 65 }),
      expect.objectContaining({ stock_kind: "BOTTLE_CARTON", quantity: 10 }),
    ]),
  );
  await page.goto("/admin/inventory");
  await expect(page.getByText("20", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("65", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/sign-in/);
  await login(page);
  await page.goto(tripPath);
  await expect(
    page.getByRole("heading", { name: "Physical trip closed", exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/TRIP RETURN/)).toHaveCount(3);
});
