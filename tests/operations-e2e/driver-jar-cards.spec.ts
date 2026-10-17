import { driverNavigate } from "../offline-e2e/driver-navigation";
import { randomUUID } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import { activeFixtureTrip, fixtureIds } from "./fixture-client";

async function login(page: Page) {
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "English", exact: true }).click();
  await page.getByLabel("Email address").fill("driver@fixture.example");
  await page.getByLabel("Password", { exact: true }).fill("fixture-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/driver\/home/);
  await page.getByRole("button", { name: "English", exact: true }).click();
}
test("driver cards keep confirmed quantities, group customers, filter BS dates, sort and show authorized details", async ({
  page,
  request,
}, testInfo) => {
  const f = await activeFixtureTrip(request);
  const day = (await f.admin.workspace()).days.find(
    (d) => d.status === "OPEN",
  )!.id;
  await f.admin.rpc("save_customer", {
    p_id: f.customer,
    p_name: "ABC Hotel",
    p_shop: "",
    p_phone: "9801234567",
    p_address: "Kathmandu",
    p_notes: "",
    p_active: true,
    p_version: 1,
    p_reason: "Isolated UI test",
    p_key: randomUUID(),
  });
  await f.admin.rpc("adjust_customer_custody", {
    p_customer: f.customer,
    p_product: fixtureIds.jar,
    p_delta: 10,
    p_day: day,
    p_reason: "Verified opening holdings",
    p_key: randomUUID(),
  });
  const other = randomUUID();
  await f.admin.rpc("save_customer", {
    p_id: other,
    p_name: "Mountain Cafe",
    p_shop: "",
    p_phone: "9807654321",
    p_address: "",
    p_notes: "",
    p_active: true,
    p_version: 0,
    p_reason: "Isolated second customer",
    p_key: randomUUID(),
  });
  for (const [id, full, empty] of [
    [f.customer, 8, 5],
    [other, 20, 0],
  ] as const)
    await f.driver.rpc("post_driver_delivery", {
      p_trip: f.trip,
      p_customer: id,
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
      p_status: "CREDIT",
      p_received: null,
      p_notes: "Confirmed test",
      p_key: randomUUID(),
    });
  const before = await f.admin.workspace(f.trip);
  await login(page);
  await driverNavigate(page, "Unreturned Jars");
  await expect(
    page.getByRole("heading", { name: "Unreturned Jars", exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("driver-pending-total")).toHaveText("33");
  await expect(page.getByTestId("driver-pending-customers")).toHaveText("2");
  const cards = page.getByTestId("driver-jar-card");
  await expect(cards).toHaveCount(2);
  await expect(cards.first()).toHaveAttribute("data-customer-id", other);
  await page
    .getByRole("combobox", { name: "Sort by", exact: true })
    .selectOption("oldest");
  await expect(cards.first()).toHaveAttribute("data-customer-id", f.customer);
  await page
    .getByRole("combobox", { name: "Sort by", exact: true })
    .selectOption("recent");
  await expect(cards.first()).toHaveAttribute("data-customer-id", other);
  await page.getByLabel("Search customer", { exact: true }).fill("1234567");
  await expect(cards).toHaveCount(1);
  await expect(
    cards.first().getByText("13 Jars", { exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("driver-pending-total")).toHaveText("33");
  await page.getByLabel("Search customer", { exact: true }).fill("");
  await page
    .getByRole("button", { name: "Filter delivery dates", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Date range", exact: true })
    .selectOption("previous-month");
  await expect(
    page.getByText("No customers match your filters.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("driver-pending-total")).toHaveText("33");
  await page.getByRole("button", { name: "Clear dates", exact: true }).click();
  await expect(cards).toHaveCount(2);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("driver-jar-cards.png"),
    fullPage: true,
  });
  await page
    .locator(
      `[data-testid="driver-jar-card"][data-customer-id="${f.customer}"]`,
    )
    .click();
  const detail = page.getByTestId("driver-jar-details");
  await expect(
    detail.getByRole("heading", { name: "ABC Hotel", exact: true }),
  ).toBeVisible();
  await expect(
    detail.getByText("13 Pending Jars", { exact: true }),
  ).toBeVisible();
  await expect(
    detail.getByText("Loading jar activity…", { exact: true }),
  ).toHaveCount(0);
  await expect(
    detail.getByText(/^Balance after:/).filter({ hasText: "13 Jars" }),
  ).toBeVisible();
  await expect(
    detail.getByRole("heading", { name: "Pending deliveries", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("driver-jar-details.png"),
    fullPage: true,
  });
  const after = await f.admin.workspace(f.trip);
  expect(after.custody).toEqual(before.custody);
  expect(after.visits).toEqual(before.visits);
  expect(after.balances).toEqual(before.balances);
  await page
    .getByRole("button", { name: "Back to pending customers", exact: true })
    .click();
  await page.getByRole("button", { name: "नेपाली", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "फिर्ता आउन बाँकी जार", exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("driver-pending-total")).toHaveText("३३");
  await expect(
    cards.first().getByText("फिर्ता गर्न बाँकी", { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
