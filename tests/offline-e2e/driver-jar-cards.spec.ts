import { driverNavigate } from "./driver-navigation";
import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import {
  activeFixtureTrip,
  fixtureIds,
} from "../operations-e2e/fixture-client";
import type { DeliveryCustomerContext } from "../../src/domain/operations/customer-context";
async function nav(page: Page, label: string) {
  await driverNavigate(page, label);
}
test("same customer cards survive offline reopening, keep device estimates and reconcile with admin once", async ({
  page,
  context,
  request,
}, testInfo) => {
  page.on("dialog", (d) => d.accept());
  const f = await activeFixtureTrip(request);
  const day = (await f.admin.workspace()).days.find(
    (d) => d.status === "OPEN",
  )!.id;
  await f.admin.rpc("adjust_customer_custody", {
    p_customer: f.customer,
    p_product: fixtureIds.jar,
    p_delta: 10,
    p_day: day,
    p_reason: "Verified opening jars",
    p_key: randomUUID(),
  });
  await f.driver.rpc("post_driver_delivery", {
    p_trip: f.trip,
    p_customer: f.customer,
    p_walk_name: "",
    p_walk_phone: "",
    p_items: [
      { product_id: fixtureIds.jar, full_jars: 8, empty_jars: 5, cartons: 0 },
    ],
    p_status: "CREDIT",
    p_received: null,
    p_notes: "Confirmed initial test",
    p_key: randomUUID(),
  });
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "English", exact: true }).click();
  await page.getByLabel("Email address").fill("driver@fixture.example");
  await page.getByLabel("Password", { exact: true }).fill("fixture-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/driver\/home/);
  await page.getByRole("button", { name: "English", exact: true }).click();
  await expect(page.getByTestId("driver-remaining-full-jars")).toHaveText("92");
  await expect(page.getByText("Offline ready", { exact: true })).toBeVisible({
    timeout: 30000,
  });

  await expect(page.getByText("All synced", { exact: true })).toBeVisible({
    timeout: 30000,
  });
  await nav(page, "Unreturned Jars");
  await expect(page.getByTestId("driver-pending-total")).toHaveText("13");
  await nav(page, "New Sale");
  await page
    .getByRole("button", { name: "Refresh customer", exact: true })
    .click();
  await context.setOffline(true);
  await expect(
    page
      .getByTestId("driver-sync-status")
      .getByText("Offline", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Jars Delivered", { exact: true }).fill("5");
  await page.getByLabel("Empty Jars Returned", { exact: true }).fill("10");
  await page.getByRole("button", { name: "Credit", exact: true }).click();
  await page
    .getByRole("button", { name: "Review delivery", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Save Delivery", exact: true })
    .click();
  await nav(page, "Unreturned Jars");
  await expect(page.getByTestId("driver-pending-total")).toHaveText("8");
  const card = page.getByTestId("driver-jar-card");
  await expect(card).toHaveCount(1);
  await expect(card.getByText("8 Jars", { exact: true })).toBeVisible();
  await expect(
    card.getByText("Saved on Device", { exact: true }),
  ).toBeVisible();
  const unsynced = await f.admin.workspace(f.trip);
  expect(
    unsynced.custody.find((c) => c.customer_id === f.customer)!.quantity,
  ).toBe(13);
  expect(unsynced.visits).toHaveLength(1);
  await card.click();
  await expect(
    page
      .getByTestId("driver-jar-details")
      .getByText("8 Pending Jars", { exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByTestId("driver-jar-details")
      .getByText(/^Balance after:\s*8 Jars$/),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Back to pending customers", exact: true })
    .click();
  await page.reload();
  await page.getByRole("button", { name: "English", exact: true }).click();

  await expect(page.getByTestId("driver-pending-total")).toHaveText("8");
  await expect(
    card.getByText("Saved on Device", { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("driver-offline-jar-cards.png"),
    fullPage: true,
  });
  await context.setOffline(false);
  await expect(page.getByText("All synced", { exact: true })).toBeVisible({
    timeout: 30000,
  });
  await expect(card.getByText("Saved on Device", { exact: true })).toHaveCount(
    0,
  );
  await expect(page.getByTestId("driver-pending-total")).toHaveText("8");
  const confirmed = await f.admin.workspace(f.trip);
  expect(confirmed.visits).toHaveLength(2);
  expect(
    confirmed.custody.find((c) => c.customer_id === f.customer)!.quantity,
  ).toBe(8);
  const driver = await f.driver.rpc<DeliveryCustomerContext>(
    "delivery_customer_context",
    { p_trip: f.trip, p_customer: f.customer },
  );
  expect(driver.custody[0]!.quantity).toBe(8);
  const pending = await f.admin.rpc<{ rows: { pending: number }[] }>(
    "pending_jar_workspace",
    { p_trip: null, p_customer: f.customer },
  );
  expect(pending.rows.reduce((n, r) => n + r.pending, 0)).toBe(8);
});
