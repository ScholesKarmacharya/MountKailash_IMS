import { randomUUID } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import {
  fixtureClient,
  fixtureIds,
  fixtureProvider,
} from "../operations-e2e/fixture-client";
import { activeScreen, driverNavigate } from "./driver-navigation";

async function login(page: Page) {
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "English", exact: true }).click();
  await page.getByLabel("Email address").fill("driver@fixture.example");
  await page.getByLabel("Password", { exact: true }).fill("fixture-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/driver\/home/);
  await page.getByRole("button", { name: "English", exact: true }).click();
  page.on("dialog", (dialog) => dialog.accept());
}
async function localEvidence(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const q = indexedDB.open("mount-kailash-offline");
      q.onsuccess = () => resolve(q.result);
      q.onerror = () => reject(q.error);
    });
    const read = <T>(store: string, key?: string) =>
      new Promise<T>((resolve, reject) => {
        const s = db.transaction(store).objectStore(store);
        const q = key ? s.get(key) : s.getAll();
        q.onsuccess = () => resolve(q.result);
        q.onerror = () => reject(q.error);
      });
    const rows = await read<
      Array<{
        id: string;
        user: string;
        trip: string;
        salt: number[];
        iv: number[];
        cipher: number[];
        retired?: boolean;
      }>
    >("vaults");
    const evidence = [];
    for (const row of rows) {
      const settings = await read<{ value: string }>(
        "settings",
        `automatic-device:${row.user}`,
      );
      const { secret } = JSON.parse(settings.value) as { secret: string };
      const material = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(secret),
        "PBKDF2",
        false,
        ["deriveKey"],
      );
      const key = await crypto.subtle.deriveKey(
        {
          name: "PBKDF2",
          salt: new Uint8Array(row.salt),
          iterations: 210000,
          hash: "SHA-256",
        },
        material,
        { name: "AES-GCM", length: 256 },
        false,
        ["decrypt"],
      );
      const bytes = await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: new Uint8Array(row.iv),
          additionalData: new TextEncoder().encode(row.id),
        },
        key,
        new Uint8Array(row.cipher),
      );
      const saved = JSON.parse(new TextDecoder().decode(bytes));
      evidence.push({
        trip: row.trip,
        retired: row.retired,
        operations: saved.operations,
        loads: saved.snapshot.workspace.loads,
        cancelled: saved.retired?.cancelled,
      });
    }
    db.close();
    return evidence;
  });
}

test("cancelled trip 8 leaves the dashboard, trip 9 owns a separate vault and notification details start it once", async ({
  page,
  request,
  context,
}) => {
  test.setTimeout(180000);
  expect((await request.post(`${fixtureProvider}/reset`)).ok()).toBe(true);
  const admin = await fixtureClient(request);
  const vehicle = randomUUID();
  await admin.rpc("save_vehicle", {
    p_id: vehicle,
    p_plate: "2102",
    p_description: "",
    p_active: true,
    p_version: 0,
    p_reason: "Isolated cancellation scenario",
    p_key: randomUUID(),
  });
  const day = (await admin.workspace()).days.find((d) => d.status === "OPEN")!;
  const schedule = async () => {
    const id = randomUUID();
    await admin.rpc("schedule_trip", {
      p_id: id,
      p_driver: fixtureIds.driver,
      p_vehicle: vehicle,
      p_day: day.id,
      p_scheduled: day.date_label,
      p_notes: "",
      p_key: randomUUID(),
    });
    return id;
  };
  for (let n = 0; n < 7; n++) {
    const id = await schedule();
    await admin.rpc("transition_trip", {
      p_trip: id,
      p_action: "CANCEL",
      p_reason: "Unused historical draft",
      p_key: randomUUID(),
    });
  }
  const old = await schedule();
  const carton = (await admin.workspace()).products.find(
    (p) => p.kind === "BOTTLE_CARTON",
  )!.id;
  const load = (trip: string, jars: number, cartons: number) =>
    admin.rpc("load_trip", {
      p_trip: trip,
      p_items: [
        { product_id: fixtureIds.jar, stock_kind: "FULL_JAR", quantity: jars },
        { product_id: carton, stock_kind: "BOTTLE_CARTON", quantity: cartons },
      ],
      p_key: randomUUID(),
    });
  await load(old, 10, 2);
  await page.addInitScript(() => {
    (window as unknown as { tripEvents: number }).tripEvents = 0;
    window.addEventListener(
      "mk-driver-trip-changed",
      () => (window as unknown as { tripEvents: number }).tripEvents++,
    );
  });
  await login(page);
  await expect(page.getByTestId("driver-trip-card")).toContainText("Trip #8");
  await expect(page.getByText("Offline ready", { exact: true })).toBeVisible({
    timeout: 30000,
  });
  await expect(page.getByText("All synced", { exact: true })).toBeVisible({
    timeout: 30000,
  });
  const before = (await localEvidence(page)).find((r) => r.trip === old)!;
  await admin.rpc("trip_preparation_command", {
    p_trip: old,
    p_action: "UNLOAD_CANCEL",
    p_scheduled: null,
    p_reason: "Confirmed physical cancellation",
    p_counts: [
      { product_id: fixtureIds.jar, stock_kind: "FULL_JAR", quantity: 10 },
      { product_id: fixtureIds.jar, stock_kind: "EMPTY_JAR", quantity: 0 },
      { product_id: carton, stock_kind: "BOTTLE_CARTON", quantity: 2 },
    ],
    p_key: randomUUID(),
  });
  await page.getByTestId("notification-bell").click();
  await expect(page.getByTestId("driver-trip-card")).toHaveCount(0, {
    timeout: 15000,
  });
  await expect(
    page.getByRole("button", { name: "Start Trip", exact: true }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  const replacement = await schedule();
  await load(replacement, 25, 10);
  await page.getByTestId("notification-bell").click();
  const panel = page.getByRole("dialog", {
    name: "Notifications",
    exact: true,
  });
  await expect(
    panel.getByTestId("notification-item").filter({ hasText: "Trip #9" }),
  ).toHaveCount(2, { timeout: 15000 });
  await expect(page.getByTestId("driver-trip-card")).toContainText("Trip #9", {
    timeout: 15000,
  });
  await expect(page.getByTestId("driver-trip-card")).toContainText(
    "Ready to Start",
  );
  await expect(page.getByTestId("driver-remaining-full-jars")).toHaveText("25");
  await expect(page.getByTestId("driver-cartons-remaining")).toHaveText("10");
  await expect(page.getByText("Offline ready", { exact: true })).toBeVisible({
    timeout: 30000,
  });
  expect(
    await page.evaluate(
      () => (window as unknown as { tripEvents: number }).tripEvents,
    ),
  ).toBeGreaterThan(0);
  await page.keyboard.press("Escape");
  const after = await localEvidence(page);
  expect(after).toHaveLength(2);
  expect(after.find((r) => r.trip === old)).toMatchObject({
    retired: true,
    cancelled: true,
    operations: before.operations,
    loads: before.loads,
  });
  expect(after.find((r) => r.trip === replacement)?.retired).toBe(false);
  await driverNavigate(page, "Sales History");
  await activeScreen(page)
    .getByText("Delivery rounds and empty returns", { exact: true })
    .click();
  await expect(
    activeScreen(page)
      .locator(`a[href="/driver/trips/${old}"]`)
      .locator("..")
      .locator(".."),
  ).toContainText("Cancelled");
  await driverNavigate(page, "My Stock");
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId("driver-trip-card")).toContainText(
    /Trip #[9९]/,
    { timeout: 30000 },
  );
  await page.getByRole("button", { name: "English", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Start Trip", exact: true }),
  ).toBeDisabled();
  await context.setOffline(false);
  await expect(
    page.getByRole("button", { name: "Start Trip", exact: true }),
  ).toBeEnabled({ timeout: 30000 });
  await page.getByTestId("notification-bell").click();
  const notification = panel
    .getByTestId("notification-item")
    .filter({ hasText: "Trip #9" })
    .first();
  await expect(
    notification.getByRole("link", { name: "View Trip", exact: true }),
  ).toHaveAttribute("href", `/driver/trips/${replacement}`);
  await notification
    .getByRole("link", { name: "View Trip", exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`/driver/trips/${replacement}$`));
  await expect(
    page.getByRole("heading", { name: "Trip #9", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Start Trip", exact: true }),
  ).toBeEnabled({ timeout: 30000 });
  let starts = 0;
  page.on("request", (req) => {
    if (req.method() === "POST" && req.headers()["next-action"]) starts++;
  });
  await page
    .getByRole("button", { name: "Start Trip", exact: true })
    .locator("..")
    .locator("..")
    .evaluate((node) => {
      const form = node as HTMLFormElement;
      const button = form.querySelector<HTMLButtonElement>(
        'button[type="submit"]',
      )!;
      form.requestSubmit(button);
      form.requestSubmit(button);
    });
  await expect
    .poll(async () => (await admin.workspace(replacement)).trips[0]?.status, {
      timeout: 30000,
    })
    .toBe("ACTIVE");
  await expect(
    page.getByText("Trip active", { exact: true }).first(),
  ).toBeVisible({ timeout: 30000 });
  await expect(
    page.getByRole("button", { name: "Start Trip", exact: true }),
  ).toHaveCount(0);
  expect(starts).toBe(1);
  const kept = (await localEvidence(page)).find((r) => r.trip === old)!;
  expect(kept.operations).toEqual(before.operations);
  expect(kept.loads).toEqual(before.loads);
  expect((await admin.workspace(old)).trips[0]).toMatchObject({
    status: "CLOSED",
    cancelled: true,
    trip_number: 8,
  });
});

test("a burst of trip-change prompts coalesces workspace requests", async ({
  page,
  request,
}) => {
  const { activeFixtureTrip } =
    await import("../operations-e2e/fixture-client");
  await activeFixtureTrip(request, 25, 0, false);
  await login(page);
  await expect(page.getByText("Offline ready", { exact: true })).toBeVisible({
    timeout: 30000,
  });
  await expect(page.getByText("All synced", { exact: true })).toBeVisible({
    timeout: 30000,
  });
  let active = 0,
    maximum = 0,
    requests = 0;
  await page.route("**/api/driver/workspace?*", async (route) => {
    active++;
    requests++;
    maximum = Math.max(maximum, active);
    try {
      await new Promise((resolve) => setTimeout(resolve, 200));
      const response = await route.fetch();
      await route.fulfill({ response });
    } finally {
      active--;
    }
  });
  await page.evaluate(() => {
    for (let i = 0; i < 20; i++)
      window.dispatchEvent(new Event("mk-driver-trip-changed"));
  });
  await expect.poll(() => requests).toBeGreaterThanOrEqual(2);
  await expect.poll(() => active).toBe(0);
  expect(maximum).toBe(1);
  expect(requests).toBeLessThanOrEqual(3);
});
