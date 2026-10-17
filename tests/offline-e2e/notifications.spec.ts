import { driverNavigate, driverReturn } from "./driver-navigation";
import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import {
  activeFixtureTrip,
  fixtureIds,
} from "../operations-e2e/fixture-client";

test("encrypted notifications survive offline reopening, defer return alerts, and reconcile read changes and missed events", async ({
  page,
  context,
  request,
}, testInfo) => {
  const f = await activeFixtureTrip(request);
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "English", exact: true }).click();
  await page.getByLabel("Email address").fill("driver@fixture.example");
  await page.getByLabel("Password", { exact: true }).fill("fixture-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/driver\/home/);
  await page.getByRole("button", { name: "English", exact: true }).click();
  await expect(page.getByTestId("notification-badge")).toHaveText("2", {
    timeout: 15000,
  });
  await expect(page.getByText("Offline ready", { exact: true })).toBeVisible({
    timeout: 30000,
  });

  await expect(page.getByText("All synced", { exact: true })).toBeVisible({
    timeout: 30000,
  });
  // Refresh the feed after vault creation, so history is encrypted there.
  await page.getByTestId("notification-bell").click();
  const panel = page.getByRole("dialog", {
    name: "Notifications",
    exact: true,
  });
  await expect(panel.getByTestId("notification-item")).toHaveCount(2);
  await expect
    .poll(async () =>
      page.evaluate(async () => {
        const db = await new Promise<IDBDatabase>((resolve) => {
          const q = indexedDB.open("mount-kailash-offline");
          q.onsuccess = () => resolve(q.result);
        });
        const rows = await new Promise<unknown[]>((resolve) => {
          const q = db.transaction("vaults").objectStore("vaults").getAll();
          q.onsuccess = () => resolve(q.result);
        });
        db.close();
        return JSON.stringify(rows).includes("Fixture driver");
      }),
    )
    .toBe(false);
  await page.keyboard.press("Escape");
  await context.setOffline(true);
  await expect(
    page
      .getByTestId("driver-sync-status")
      .getByText("Offline", { exact: true }),
  ).toBeVisible();
  await page.getByTestId("notification-bell").click();
  await expect(
    panel.getByText("Offline · Showing saved notifications", { exact: true }),
  ).toBeVisible();
  await panel
    .getByTestId("notification-item")
    .first()
    .getByRole("button", { name: "Mark as Read", exact: true })
    .click();
  await expect(page.getByTestId("notification-badge")).toHaveText("1");
  await page.keyboard.press("Escape");
  // Reopen the service-worker shell; the PIN must gate private history.
  await page.reload();
  await expect(page.getByTestId("notification-bell")).toBeVisible();
  await expect(page.getByTestId("notification-badge")).toHaveCount(0);
  await page.getByRole("button", { name: "English", exact: true }).click();

  await expect(page.getByTestId("notification-badge")).toHaveText("1");
  await driverNavigate(page, "Return to Warehouse");
  await driverReturn(page);
  await expect(
    page.getByText("Return submitted. Waiting for warehouse confirmation.", {
      exact: true,
    }),
  ).toBeVisible();
  expect((await f.admin.workspace(f.trip)).trips[0]!.status).toBe("ACTIVE");
  expect(
    (
      await f.admin.rpc<{ unread: number }>("notification_feed", {
        p_before: null,
      })
    ).unread,
  ).toBe(0);
  await context.setOffline(false);
  await expect
    .poll(async () => (await f.admin.workspace(f.trip)).trips[0]!.status, {
      timeout: 30000,
    })
    .toBe("SUBMITTED");
  expect(
    (
      await f.admin.rpc<{ unread: number }>("notification_feed", {
        p_before: null,
      })
    ).unread,
  ).toBe(1);
  await expect
    .poll(
      async () =>
        (
          await f.driver.rpc<{ unread: number }>("notification_feed", {
            p_before: null,
          })
        ).unread,
      { timeout: 20000 },
    )
    .toBe(1);
  await context.setOffline(true);
  await expect(
    page
      .getByTestId("driver-sync-status")
      .getByText("Offline", { exact: true }),
  ).toBeVisible();
  await page.getByTestId("notification-bell").click();
  await panel
    .getByRole("button", { name: "Mark All as Read", exact: true })
    .click();
  await expect(page.getByTestId("notification-badge")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await f.admin.rpc("reconcile_trip", {
    p_trip: f.trip,
    p_counts: [
      { product_id: fixtureIds.jar, stock_kind: "FULL_JAR", quantity: 100 },
      { product_id: fixtureIds.jar, stock_kind: "EMPTY_JAR", quantity: 0 },
    ],
    p_reason: "Confirmed physical warehouse return",
    p_accept_variance: false,
    p_key: randomUUID(),
  });
  const day = (await f.admin.workspace()).days.find(
    (d) => d.status === "OPEN",
  )!;
  const newTrip = randomUUID();
  await f.admin.rpc("schedule_trip", {
    p_id: newTrip,
    p_driver: fixtureIds.driver,
    p_vehicle: (await f.admin.workspace(f.trip)).trips[0]!.vehicle_id,
    p_day: day.id,
    p_scheduled: day.date_label,
    p_notes: "",
    p_key: randomUUID(),
  });
  await expect(page.getByTestId("notification-toast")).toHaveCount(0);
  await expect(page.getByTestId("notification-badge")).toHaveCount(0);
  await context.setOffline(false);
  await expect(page.getByTestId("notification-badge")).toHaveText("2", {
    timeout: 30000,
  });
  await expect(page.getByTestId("notification-toast")).toBeVisible();
  await page
    .getByRole("button", { name: "Dismiss notification", exact: true })
    .click();
  await page.getByTestId("notification-bell").click();
  await expect(panel.getByTestId("notification-item")).toHaveCount(4);
  await expect(
    panel
      .getByTestId("notification-item")
      .first()
      .getByRole("link", { name: "View Trip", exact: true }),
  ).toHaveAttribute("href", `/driver/trips/${newTrip}`);
  await expect
    .poll(
      async () =>
        (
          await f.driver.rpc<{ unread: number }>("notification_feed", {
            p_before: null,
          })
        ).unread,
    )
    .toBe(2);
  await page.screenshot({
    path: `test-results/notifications-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await page.keyboard.press("Escape");
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.getByTestId("notification-bell").click();
  await expect(panel.getByTestId("notification-item")).toHaveCount(4);
  await expect(page.getByTestId("notification-toast")).toHaveCount(0);
});
