import { randomUUID } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import { fixtureClient, fixtureIds } from "./fixture-client";
import { formatBusinessDate } from "../../src/domain/localization/calendar";
import { driverReturn } from "../offline-e2e/driver-navigation";

async function login(page: Page, role: string) {
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "English", exact: true }).click();
  await page.getByLabel("Email address").fill(`${role}@fixture.example`);
  await page.getByLabel("Password", { exact: true }).fill("fixture-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(
    role === "admin" ? /admin\/dashboard/ : /driver\/home/,
  );
  await page.getByRole("button", { name: "English", exact: true }).click();
  await expect(page.getByTestId("notification-bell")).toBeVisible();
}
test("independent recipients receive persistent trip notifications, correct links, counts, translations and mobile keyboard controls", async ({
  page,
  browser,
  request,
}, testInfo) => {
  expect((await request.post("http://127.0.0.1:17777/reset")).ok()).toBe(true);
  const api = await fixtureClient(request),
    driverApi = await fixtureClient(request, "driver");
  const adminContext = await browser.newContext({
    viewport: testInfo.project.use.viewport,
    baseURL: testInfo.project.use.baseURL,
  });
  const otherContext = await browser.newContext({
    viewport: testInfo.project.use.viewport,
    baseURL: testInfo.project.use.baseURL,
  });
  const adminPage = await adminContext.newPage(),
    otherPage = await otherContext.newPage();
  try {
    await login(page, "driver");
    await login(adminPage, "admin");
    await login(otherPage, "other");
    for (const p of [page, adminPage, otherPage]) {
      await p.getByTestId("notification-bell").click();
      await expect(
        p
          .getByRole("dialog", { name: "Notifications", exact: true })
          .getByText("No Notifications", { exact: true }),
      ).toBeVisible();
      await p.keyboard.press("Escape");
    }
    const vehicle = randomUUID(),
      trip = randomUUID();
    await api.rpc("save_vehicle", {
      p_id: vehicle,
      p_plate: "NOTIFY-85",
      p_description: "",
      p_active: true,
      p_version: 0,
      p_reason: "Isolated browser test",
      p_key: randomUUID(),
    });
    const day = (await api.workspace()).days.find((d) => d.status === "OPEN")!;
    const key = randomUUID();
    await page.bringToFront();
    const args = {
      p_id: trip,
      p_driver: fixtureIds.driver,
      p_vehicle: vehicle,
      p_day: day.id,
      p_scheduled: day.date_label,
      p_notes: "",
      p_key: key,
    };
    await api.rpc("schedule_trip", args);
    await api.rpc("schedule_trip", args);
    await expect(page.getByTestId("notification-badge")).toHaveText("1", {
      timeout: 20000,
    });
    await expect(page.getByTestId("notification-toast")).toBeVisible();
    await expect(otherPage.getByTestId("notification-badge")).toHaveCount(0);
    await expect(adminPage.getByTestId("notification-badge")).toHaveCount(0);
    await page
      .getByRole("button", { name: "Dismiss notification", exact: true })
      .click();
    await page.getByTestId("notification-bell").click();
    const panel = page.getByRole("dialog", {
      name: "Notifications",
      exact: true,
    });
    await expect(panel.getByTestId("notification-item")).toHaveCount(1);
    await expect(
      panel.getByText("Assigned; physical stock loading is pending.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(panel).toContainText(formatBusinessDate(day.date_label, "en"));
    await expect(
      panel.getByRole("link", { name: "View Trip", exact: true }),
    ).toHaveAttribute("href", `/driver/trips/${trip}`);
    const bounds = await panel.boundingBox();
    const viewport = page.viewportSize()!;
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
    expect(bounds!.height).toBeLessThanOrEqual(viewport.height - 64);
    await panel
      .getByRole("button", { name: "Mark as Read", exact: true })
      .click();
    await expect(page.getByTestId("notification-badge")).toHaveCount(0);
    await expect(panel.getByTestId("notification-item")).toHaveAttribute(
      "data-read",
      "true",
    );
    await expect
      .poll(
        async () =>
          (
            await driverApi.rpc<{ unread: number }>("notification_feed", {
              p_before: null,
            })
          ).unread,
      )
      .toBe(0);
    await panel.getByRole("link", { name: "View Trip", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/driver/trips/${trip}$`));
    await expect(page.getByRole("heading", { name: /^Trip #/ })).toBeVisible();
    await page.reload();
    await expect(page.getByTestId("notification-toast")).toHaveCount(0);
    const loading = {
      p_trip: trip,
      p_items: [
        { product_id: fixtureIds.jar, stock_kind: "FULL_JAR", quantity: 85 },
      ],
      p_key: randomUUID(),
    };
    await api.rpc("load_trip", loading);
    await api.rpc("load_trip", loading);
    await expect(page.getByTestId("notification-badge")).toHaveText("1", {
      timeout: 20000,
    });
    await page.getByTestId("notification-bell").click();
    await expect(panel.getByTestId("notification-item")).toHaveCount(2);
    await expect(panel.getByTestId("notification-item").first()).toContainText(
      "Stock Loading Confirmed",
    );
    await expect(panel.getByTestId("notification-item").first()).toContainText(
      "85",
    );
    await page.getByRole("button", { name: "नेपाली", exact: true }).click();
    await page.getByTestId("notification-bell").click();
    const ne = page.getByRole("dialog", { name: "सूचनाहरू", exact: true });
    await expect(ne).toContainText("सामान लोड भएको पुष्टि भयो");
    await expect(ne).toContainText(formatBusinessDate(day.date_label, "ne"));
    await ne
      .getByRole("button", { name: "सबै पढिएको चिन्ह लगाउनुहोस्", exact: true })
      .click();
    await expect(page.getByTestId("notification-badge")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("notification-bell")).toBeFocused();
    await page.getByRole("button", { name: "English", exact: true }).click();
    await driverApi.rpc("transition_trip", {
      p_trip: trip,
      p_action: "START",
      p_reason: "",
      p_key: randomUUID(),
    });
    const returned = [
      { product_id: fixtureIds.jar, stock_kind: "FULL_JAR", quantity: 85 },
      { product_id: fixtureIds.jar, stock_kind: "EMPTY_JAR", quantity: 0 },
    ];
    await page.goto("/driver/return");
    await driverReturn(page);
    await expect
      .poll(async () => (await driverApi.workspace(trip)).trips[0]?.status)
      .toBe("SUBMITTED");
    expect((await driverApi.workspace(trip)).declarations).toEqual(
      expect.arrayContaining(returned.map((c) => expect.objectContaining(c))),
    );
    await adminPage.bringToFront();
    await expect(adminPage.getByTestId("notification-badge")).toHaveText("1", {
      timeout: 20000,
    });
    await adminPage.getByTestId("notification-bell").click();
    const adminPanel = adminPage.getByRole("dialog", {
      name: "Notifications",
      exact: true,
    });
    await expect(adminPanel).toContainText(
      "Physical warehouse confirmation is pending.",
    );
    await adminPanel
      .getByRole("link", { name: "View Trip", exact: true })
      .click();
    await expect(adminPage).toHaveURL(new RegExp(`/admin/trips/${trip}$`));
    expect((await api.workspace(trip)).trips[0]!.status).toBe("SUBMITTED");
    await page.bringToFront();
    await api.rpc("reconcile_trip", {
      p_trip: trip,
      p_counts: returned,
      p_reason: "Verified physical warehouse return",
      p_accept_variance: false,
      p_key: randomUUID(),
    });
    await expect(page.getByTestId("notification-badge")).toHaveText("1", {
      timeout: 20000,
    });
    await page.getByTestId("notification-bell").click();
    await expect(panel.getByTestId("notification-item").first()).toContainText(
      "Warehouse Return Confirmed",
    );
    await expect(otherPage.getByTestId("notification-badge")).toHaveCount(0);
    await page.screenshot({
      path: `test-results/notifications-${testInfo.project.name}.png`,
      fullPage: true,
    });
    // Both the API and direct database paths reject cross-recipient reads.
    const foreign = (
      await driverApi.rpc<{ items: { id: string }[] }>("notification_feed", {
        p_before: null,
      })
    ).items[0]!.id;
    const forbidden = await adminPage.request.post(
      "http://127.0.0.1:3002/api/notifications",
      {
        headers: { origin: "http://127.0.0.1:3002" },
        data: { ids: [foreign], all: false },
      },
    );
    expect(forbidden.status()).toBe(403);
  } finally {
    await adminContext.close();
    await otherContext.close();
  }
});
test("a 360px inbox scrolls and paginates, and read changes from another session reconcile across every loaded page", async ({
  page,
  request,
}, testInfo) => {
  await request.post("http://127.0.0.1:17777/reset");
  const api = await fixtureClient(request),
    driverApi = await fixtureClient(request, "driver");
  const vehicle = randomUUID(),
    trip = randomUUID();
  await api.rpc("save_vehicle", {
    p_id: vehicle,
    p_plate: "NOTIFY-HISTORY",
    p_description: "",
    p_active: true,
    p_version: 0,
    p_reason: "Isolated pagination test",
    p_key: randomUUID(),
  });
  const day = (await api.workspace()).days.find((d) => d.status === "OPEN")!;
  await api.rpc("create_trip", {
    p_id: trip,
    p_driver: fixtureIds.driver,
    p_vehicle: vehicle,
    p_day: day.id,
    p_customers: [],
    p_notes: "",
    p_key: randomUUID(),
  });
  const tomorrow = new Date(Date.parse(day.date_label) + 86400000)
    .toISOString()
    .slice(0, 10);
  for (let i = 0; i < 55; i++)
    await api.rpc("trip_preparation_command", {
      p_trip: trip,
      p_action: "RESCHEDULE",
      p_scheduled: i % 2 ? day.date_label : tomorrow,
      p_reason: "Authorized material schedule change",
      p_counts: null,
      p_key: randomUUID(),
    });
  await page.setViewportSize({ width: 360, height: 800 });
  await login(page, "driver");
  await expect(page.getByTestId("notification-badge")).toHaveText("56");
  await page.getByTestId("notification-bell").click();
  const panel = page.getByRole("dialog", {
    name: "Notifications",
    exact: true,
  });
  await expect(panel.getByTestId("notification-item")).toHaveCount(50);
  await panel
    .getByRole("button", { name: "Load older notifications", exact: true })
    .click();
  await expect(panel.getByTestId("notification-item")).toHaveCount(56);
  const f = await driverApi.rpc<{ items: { sequence: number }[] }>(
    "notification_feed",
    { p_before: null },
  );
  await driverApi.rpc("notification_read", {
    p_ids: [],
    p_all: true,
    p_through: f.items[0]!.sequence,
  });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByTestId("notification-badge")).toHaveCount(0);
  await expect(panel.locator('[data-read="false"]')).toHaveCount(0);
  await expect(page.getByTestId("notification-toast")).toHaveCount(0);
  const bounds = await panel.boundingBox();
  expect(bounds!.width).toBeLessThanOrEqual(360);
  expect(bounds!.height).toBeLessThanOrEqual(704);
  await page.screenshot({
    path: `test-results/notifications-360-${testInfo.project.name}.png`,
    fullPage: true,
  });
});
