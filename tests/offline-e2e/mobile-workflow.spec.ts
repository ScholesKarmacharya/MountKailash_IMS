import { test, expect, type Page, type Locator } from "@playwright/test";
import { activeFixtureTrip } from "../operations-e2e/fixture-client";
import { driverNavigate as nav, activeScreen } from "./driver-navigation";
import type { FinanceWorkspace } from "../../src/domain/finance/types";
import { mkdirSync } from "node:fs";

async function login(page: Page, role = "driver") {
  await page.goto("/sign-in?reauth=1");
  await page.getByRole("button", { name: "English", exact: true }).click();
  await page.getByLabel("Email address").fill(`${role}@fixture.example`);
  await page.getByLabel("Password", { exact: true }).fill("fixture-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/driver/home");
  await page.getByRole("button", { name: "English", exact: true }).click();
}
async function ready(page: Page) {
  await expect(page.getByText("Offline ready", { exact: true })).toBeVisible({
    timeout: 30000,
  });
}
async function sale(
  page: Page,
  customer: string,
  status: string,
  jars: number,
  empties = 0,
  cartons = 0,
) {
  await nav(page, "New Sale");
  const screen = activeScreen(page);
  const next = screen.getByRole("button", {
    name: "Continue with updated data",
    exact: true,
  });
  if (await next.isVisible()) await next.click();
  await screen.locator(`[data-customer-id="${customer}"]`).click();
  await screen.getByLabel("Jars Delivered", { exact: true }).fill(String(jars));
  await screen
    .getByLabel("Empty Jars Returned", { exact: true })
    .fill(String(empties));
  await screen
    .getByLabel("Cartons Delivered", { exact: true })
    .fill(String(cartons));
  if (status === "CREDIT")
    await screen.getByRole("button", { name: "Credit", exact: true }).click();
  else {
    await screen.getByRole("button", { name: "Paid", exact: true }).click();
    await screen
      .getByLabel("Payment method", { exact: true })
      .selectOption(status);
  }
  await expect(screen.getByLabel("Visit notes", { exact: true })).toHaveCount(
    0,
  );
  await screen
    .getByRole("button", { name: "Review delivery", exact: true })
    .click();
  await screen
    .getByRole("button", { name: "Save Delivery", exact: true })
    .click();
  await expect(
    screen.getByText("Saved on phone", { exact: true }),
  ).toBeVisible();
}
async function visibleField(page: Page, field: Locator, height: number) {
  await field.focus();
  await page.evaluate((h) => {
    (window as unknown as { keyboardHeight: number }).keyboardHeight = h;
    window.visualViewport?.dispatchEvent(new Event("resize"));
  }, height);
  await expect
    .poll(async () => {
      const box = await field.boundingBox();
      return !!box && box.y >= 0 && box.y + box.height <= height;
    })
    .toBe(true);
  await expect(page.getByTestId("driver-bottom-nav")).not.toBeVisible();
}
test.beforeEach(({ page }) => page.on("dialog", (d) => d.accept()));

test("loaded trip has a separate online Start Trip action, then local delivery, customer, collection, history and return work offline", async ({
  page,
  context,
  request,
}) => {
  const f = await activeFixtureTrip(request, 100, 10, false);
  await login(page);
  await ready(page);
  const trip = page.getByTestId("driver-trip-card");
  await expect(trip).toContainText("Ready to Start");
  await expect(
    trip.getByRole("button", { name: "Start Trip", exact: true }),
  ).toBeEnabled();
  await context.setOffline(true);
  await expect(
    trip.getByRole("button", { name: "Start Trip", exact: true }),
  ).toBeDisabled();
  await expect(trip).toContainText(
    "Connect to the internet to start this trip. After it starts, you can continue offline.",
  );
  expect((await f.admin.workspace(f.trip)).trips[0]?.status).toBe("LOADED");
  await context.setOffline(false);
  await expect(
    trip.getByRole("button", { name: "Start Trip", exact: true }),
  ).toBeEnabled();
  await trip.getByRole("button", { name: "Start Trip", exact: true }).click();
  await expect(trip).toContainText("Trip active");
  await ready(page);
  expect((await f.admin.workspace(f.trip)).trips[0]?.status).toBe("ACTIVE");
  await sale(page, f.customer, "CREDIT", 5);
  await expect(page.getByText("All synced", { exact: true })).toBeVisible({
    timeout: 30000,
  });
  await context.setOffline(true);
  await sale(page, f.customer, "CASH", 3, 2, 1);
  await sale(page, f.customer, "FONEPAY", 2);
  const delivery = activeScreen(page);
  await delivery
    .getByRole("button", { name: "Continue with updated data", exact: true })
    .click();
  await delivery.getByRole("button", { name: "Walk-in", exact: true }).click();
  await delivery.getByLabel("Walk-in name (optional)").fill("Passing customer");
  await delivery.getByLabel("Jars Delivered", { exact: true }).fill("1");
  await delivery.getByLabel("Empty Jars Returned", { exact: true }).fill("1");
  await delivery
    .getByRole("button", { name: "Review delivery", exact: true })
    .click();
  await delivery
    .getByRole("button", { name: "Save Delivery", exact: true })
    .click();
  await nav(page, "Customers");
  await expect(
    activeScreen(page).getByLabel("Customer name", { exact: true }),
  ).toHaveCount(0);
  await activeScreen(page)
    .getByRole("button", { name: "Add Customer", exact: true })
    .click();
  await activeScreen(page)
    .getByLabel("Customer name", { exact: true })
    .fill("Mobile offline customer");
  await activeScreen(page)
    .getByLabel("Customer phone (optional)")
    .fill("9800012345");
  await activeScreen(page)
    .getByRole("button", { name: "Save and select customer", exact: true })
    .click();
  await expect(
    activeScreen(page).getByRole("button", { name: /Mobile offline customer/ }),
  ).toBeVisible();
  await activeScreen(page)
    .getByRole("button", { name: /Mobile offline customer/ })
    .click();
  await activeScreen(page)
    .getByRole("button", { name: "Edit contact", exact: true })
    .click();
  await activeScreen(page)
    .getByLabel("Customer address (optional)")
    .fill("Changed offline");
  await activeScreen(page)
    .getByRole("button", { name: "Save contact details", exact: true })
    .click();
  await expect(activeScreen(page)).toContainText("Changed offline");
  await nav(page, "Collections");
  await activeScreen(page)
    .getByLabel("Collection customer")
    .selectOption(f.customer);
  await activeScreen(page)
    .getByLabel("Credit amount received (NPR)")
    .fill("50");
  await activeScreen(page)
    .getByRole("button", { name: "Save collection", exact: true })
    .click();
  await nav(page, "My Stock");
  await expect(
    page.getByTestId("driver-remaining-full-jars").first(),
  ).toHaveText("89");
  await expect(
    page.getByTestId("driver-empty-jars-collected").first(),
  ).toHaveText("3");
  await expect(page.getByTestId("driver-cartons-remaining").first()).toHaveText(
    "9",
  );
  await nav(page, "Sales History");
  await expect(
    activeScreen(page).getByTestId("driver-history-card").first(),
  ).toBeVisible();
  await expect(
    activeScreen(page).getByTestId("driver-history-card").first(),
  ).not.toHaveAttribute("open", "");
  await activeScreen(page)
    .getByTestId("driver-history-card")
    .first()
    .locator("summary")
    .click();
  await expect(activeScreen(page)).toContainText("Fonepay pending");
  await context.setOffline(false);
  await expect(page.getByText("All synced", { exact: true })).toBeVisible({
    timeout: 45000,
  });
  const w = await f.admin.workspace(f.trip);
  expect(w.visits).toHaveLength(4);
  expect(
    w.customers.find((c) => c.name === "Mobile offline customer")?.address,
  ).toBe("Changed offline");
  const finance = await f.admin.rpc<FinanceWorkspace>("finance_workspace", {});
  expect(finance.payments).toHaveLength(4);
  expect(finance.payments.find((p) => p.method === "FONEPAY")?.status).toBe(
    "PENDING",
  );
  await nav(page, "Return to Warehouse");
  await activeScreen(page)
    .getByRole("button", { name: "Review Return", exact: true })
    .click();
  await expect(activeScreen(page)).toContainText("You are returning");
  await activeScreen(page)
    .getByRole("button", { name: "Confirm Return", exact: true })
    .click();
  await expect(activeScreen(page)).toContainText(
    "Return submitted. Waiting for warehouse confirmation.",
  );
  await expect
    .poll(async () => (await f.admin.workspace(f.trip)).trips[0]?.status)
    .toBe("SUBMITTED");
});

test("keyboard viewport keeps search, numeric, money, select and customer fields visible and preserves drafts across tabs and connectivity", async ({
  page,
  context,
  request,
}, info) => {
  await page.setViewportSize({ width: 393, height: 851 });
  await page.addInitScript(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const real = Object.getOwnPropertyDescriptor(
      VisualViewport.prototype,
      "height",
    )!.get!;
    Object.defineProperty(vv, "height", {
      get: () =>
        (window as unknown as { keyboardHeight?: number }).keyboardHeight ||
        real.call(vv),
    });
  });
  const f = await activeFixtureTrip(request, 100, 10);
  await login(page);
  await ready(page);
  await expect(
    page.getByTestId("driver-bottom-nav").getByRole("link"),
  ).toHaveCount(5);
  await nav(page, "New Sale");
  const screen = activeScreen(page);
  const search = screen.getByLabel("Search active customers");
  await search.fill("Refresh");
  await visibleField(page, search, 360);
  await screen.locator(`[data-customer-id="${f.customer}"]`).click();
  const quantity = screen.getByLabel("Jars Delivered", { exact: true });
  await quantity.fill("7");
  await visibleField(page, quantity, 360);
  await visibleField(
    page,
    screen.getByLabel("Payment method", { exact: true }),
    360,
  );
  const money = screen.getByLabel("Total Amount Received (NPR)");
  await money.fill("1051.75");
  await visibleField(page, money, 360);
  const key = await screen.locator('input[name="key"]').inputValue();
  await context.setOffline(true);
  await nav(page, "More");
  await nav(page, "New Sale");
  await expect(
    screen.getByLabel("Jars Delivered", { exact: true }),
  ).toHaveValue("7");
  await expect(screen.locator('input[name="key"]')).toHaveValue(key);
  await nav(page, "Customers");
  await activeScreen(page)
    .getByRole("button", { name: "Add Customer", exact: true })
    .click();
  await activeScreen(page)
    .getByLabel("Customer name", { exact: true })
    .fill("Unsaved mobile draft");
  const address = activeScreen(page).getByLabel("Customer address (optional)");
  await address.fill("Long address draft");
  await visibleField(page, address, 360);
  const phone = activeScreen(page).getByLabel("Customer phone (optional)");
  await phone.fill("9800012345");
  await visibleField(page, phone, 360);
  await expect(phone).toHaveAttribute("type", "tel");
  await expect(
    activeScreen(page).getByLabel("Delivery notes (optional)"),
  ).toHaveCount(0);
  await context.setOffline(false);
  await nav(page, "My Stock");
  await nav(page, "Customers");
  await expect(
    activeScreen(page).getByLabel("Customer name", { exact: true }),
  ).toHaveValue("Unsaved mobile draft");
  await expect(
    activeScreen(page).getByLabel("Customer address (optional)"),
  ).toHaveValue("Long address draft");
  await page.evaluate(() => {
    (window as unknown as { keyboardHeight: number }).keyboardHeight = 0;
    if (document.activeElement instanceof HTMLElement)
      document.activeElement.blur();
    window.visualViewport?.dispatchEvent(new Event("resize"));
  });
  await expect(page.getByTestId("driver-bottom-nav")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  mkdirSync("test-results/mobile-ui", { recursive: true });
  for (const [label, file] of [
    ["My Stock", "home"],
    ["New Sale", "delivery"],
    ["Customers", "customer"],
    ["Sales History", "history"],
    ["Return to Warehouse", "return"],
  ]) {
    await nav(page, label!);
    await page.screenshot({
      path: `test-results/mobile-ui/${info.project.name}-${file}.png`,
      fullPage: true,
    });
  }
});

test("Instant Delivery without an active trip leads home and keeps history filters secondary", async ({
  page,
  request,
}) => {
  await activeFixtureTrip(request);
  await login(page, "other");
  await nav(page, "Instant Delivery");
  await expect(activeScreen(page)).toContainText("No active trip");
  await expect(
    activeScreen(page).getByRole("link", { name: "Back to Home", exact: true }),
  ).toBeVisible();
  await expect(
    activeScreen(page).getByLabel("Search events or phone"),
  ).not.toBeVisible();
  await activeScreen(page)
    .getByText("Instant Delivery History", { exact: true })
    .click();
  await expect(
    activeScreen(page).getByLabel("Search events or phone"),
  ).toBeVisible();
});
