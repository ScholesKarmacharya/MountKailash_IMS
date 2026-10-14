import { randomUUID } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import { activeFixtureTrip, fixtureIds } from "./fixture-client";

async function login(page: Page) {
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "English", exact: true }).click();
  await page.getByLabel("Email address").fill("admin@fixture.example");
  await page.getByLabel("Password", { exact: true }).fill("fixture-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/admin\/dashboard/);
}
test("admin customer cards, confirmed refresh, filters, complete history and Nepali on desktop and mobile", async ({
  page,
  request,
}, testInfo) => {
  const { admin, driver, trip, customer } = await activeFixtureTrip(request);
  const day = (await admin.workspace()).days.find(
    (d) => d.status === "OPEN",
  )!.id;
  await admin.rpc("save_customer", {
    p_id: customer,
    p_name: "ABC Hotel",
    p_shop: "",
    p_phone: "9801234567",
    p_address: "Kathmandu",
    p_notes: "",
    p_active: true,
    p_version: 1,
    p_reason: "Isolated admin jar test",
    p_key: randomUUID(),
  });
  await admin.rpc("adjust_customer_custody", {
    p_customer: customer,
    p_product: fixtureIds.jar,
    p_delta: 10,
    p_day: day,
    p_reason: "Verified opening customer jars",
    p_key: randomUUID(),
  });
  const deliver = (full: number, empty: number) =>
    driver.rpc("post_driver_delivery", {
      p_trip: trip,
      p_customer: customer,
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
      p_status: full ? "CREDIT" : "RETURN_ONLY",
      p_received: null,
      p_notes: "Isolated test",
      p_key: randomUUID(),
    });
  await deliver(8, 5);
  const zero = randomUUID();
  await admin.rpc("save_customer", {
    p_id: zero,
    p_name: "Zero Hotel",
    p_shop: "",
    p_phone: "9809999999",
    p_address: "",
    p_notes: "",
    p_active: true,
    p_version: 0,
    p_reason: "Isolated zero test",
    p_key: randomUUID(),
  });
  await login(page);
  const nav = page.getByRole("navigation", { name: "Admin navigation" });
  await expect(
    nav.getByRole("link", { name: "Customers", exact: true }),
  ).toBeVisible();
  const links = await nav.getByRole("link").allTextContents();
  expect(links[links.indexOf("Customers") + 1]).toBe("Unreturned Jars");
  await nav.getByRole("link", { name: "Unreturned Jars", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Unreturned Jars", exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("Total Unreturned Jars")).toHaveText("13");
  await expect(page.getByTestId("Customers With Unreturned Jars")).toHaveText(
    "1",
  );
  await expect(page.getByTestId("Jars Returned This Month")).toHaveText("5");
  await expect(page.getByTestId("Jars Outstanding Over 30 Days")).toHaveText(
    "0",
  );
  const card = page.getByRole("link", {
    name: "ABC Hotel · View History",
    exact: true,
  });
  await expect(card.getByText("Jars to Return", { exact: true })).toBeVisible();
  await expect(card.getByText("13 Jars", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Zero Hotel · View History", exact: true }),
  ).toHaveCount(0);
  await page
    .getByLabel("Search name or phone", { exact: true })
    .fill("1234567");
  await expect(card).toBeVisible();
  await page
    .getByRole("combobox", { name: "Driver", exact: true })
    .selectOption(fixtureIds.driver);
  await page
    .getByRole("combobox", { name: "Jar product", exact: true })
    .selectOption(fixtureIds.jar);
  await expect(card).toBeVisible();
  await page
    .getByRole("combobox", { name: "Customer type", exact: true })
    .selectOption("HOUSE");
  await expect(
    page.getByText("No customers match these jar filters.", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: "Customer type", exact: true })
    .selectOption("");
  await page.getByLabel("Search name or phone", { exact: true }).fill("");
  await page
    .getByRole("combobox", { name: "Driver", exact: true })
    .selectOption("");
  await page
    .getByRole("combobox", { name: "Jar product", exact: true })
    .selectOption("");
  await page
    .getByRole("combobox", { name: "Jar balance", exact: true })
    .selectOption("zero");
  await expect(
    page
      .getByRole("link", { name: "Zero Hotel · View History", exact: true })
      .getByText("0 Jars", { exact: true }),
  ).toBeVisible();
  // Month summaries include returns from fully settled customers regardless of card filters.
  await expect(page.getByTestId("Jars Returned This Month")).toHaveText("5");
  await page
    .getByRole("combobox", { name: "Jar balance", exact: true })
    .selectOption("outstanding");
  await deliver(5, 10);
  await expect(card.getByText("8 Jars", { exact: true })).toBeVisible({
    timeout: 20000,
  });
  await expect(page.getByTestId("Jars Returned This Month")).toHaveText("15");
  await page.screenshot({
    path: testInfo.outputPath("admin-jar-cards.png"),
    fullPage: true,
  });
  await card.click();
  await expect(
    page.getByRole("heading", {
      name: "Customer History · ABC Hotel",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Complete jar history", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Product balance after transaction", { exact: true }),
  ).toHaveCount(3);
  await expect(
    page.getByRole("link", { name: "Audited jar correction", exact: true }),
  ).toHaveAttribute("href", `/admin/customers/${customer}#customer-custody`);
  await page
    .getByText("FIFO return allocation history", { exact: true })
    .click();
  await expect(page.getByText(/^Original custody date:/).first()).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "नेपाली", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "फिर्ता आउन बाँकी जार", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "ग्राहकको विवरण · ABC Hotel",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("link", { name: "ABC Hotel · विवरण हेर्नुहोस्", exact: true })
      .getByText("फिर्ता गर्न बाँकी जार", { exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("Total Unreturned Jars")).toHaveText("८");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
