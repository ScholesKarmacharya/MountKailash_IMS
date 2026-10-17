import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import {
  activeFixtureTrip,
  fixtureIds,
} from "../operations-e2e/fixture-client";

async function login(page: Page) {
  await page.goto("/sign-in?reauth=1");
  await page.getByRole("button", { name: "English", exact: true }).click();
  await page.getByLabel("Email address").fill("driver@fixture.example");
  await page.getByLabel("Password", { exact: true }).fill("fixture-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/driver/home");
  await page.getByRole("button", { name: "English", exact: true }).click();
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "New Sale", exact: true })
    .click();
}

const deliveryForm = (page: Page) =>
  page.locator("form").filter({
    has: page.locator('input[name="operation"][value="driver-visit"]'),
  });
const save = (page: Page) =>
  page.getByRole("button", { name: "Save Delivery", exact: true });
const ready = (page: Page) =>
  expect(page.getByText("Offline ready", { exact: true })).toBeVisible({
    timeout: 30000,
  });

async function draft(page: Page, customer: string) {
  await page.locator(`[data-customer-id="${customer}"]`).click();
  await page.getByLabel("Jars Delivered", { exact: true }).fill("7");
  await page.getByLabel("Empty Jars Returned", { exact: true }).fill("2");
  await page.getByLabel("Cartons Delivered", { exact: true }).fill("2");
  await page
    .getByLabel("Payment method", { exact: true })
    .selectOption("FONEPAY");
  await expect(page.getByLabel("Visit notes", { exact: true })).toHaveCount(0);
  await page
    .getByLabel("Total Amount Received (NPR)", { exact: true })
    .fill("1352.25");
  await page
    .getByRole("button", { name: "Review delivery", exact: true })
    .click();
  await expect(save(page)).toBeVisible();
  await deliveryForm(page).evaluate((form) => {
    form.dataset.draftIdentity = "original";
  });
  return deliveryForm(page).locator('input[name="key"]').inputValue();
}

async function preserved(page: Page, customer: string, key: string) {
  const form = deliveryForm(page);
  await expect(form).toHaveAttribute("data-draft-identity", "original");
  await expect(form.locator('input[name="key"]')).toHaveValue(key);
  await expect(form.locator('input[name="customer"]')).toHaveValue(customer);
  await expect(form.locator('input[name="notes"]')).toHaveValue("");
  await expect(form.locator('input[name="received_amount"]')).toHaveValue(
    "1352.25",
  );
  await expect(form.locator('input[name="payment_status"]')).toHaveValue(
    "FONEPAY",
  );
  const items = JSON.parse(
    await form.locator('input[name="items"]').inputValue(),
  ) as { full_jars: number; empty_jars: number; cartons: number }[];
  expect(items.reduce((n, item) => n + item.full_jars, 0)).toBe(7);
  expect(items.reduce((n, item) => n + item.empty_jars, 0)).toBe(2);
  expect(items.reduce((n, item) => n + item.cartons, 0)).toBe(2);
  // Review remains open, too: readiness changes cannot force another review.
  await expect(save(page)).toBeVisible();
}

test.beforeEach(({ page }) => page.on("dialog", (dialog) => dialog.accept()));

test("automatic preparation gates save, preserves the reviewed draft, and keeps ready across offline saves and restart", async ({
  page,
  context,
  request,
}) => {
  const f = await activeFixtureTrip(request, 100, 10);
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  let registrations = 0;
  let devices = 0;
  await page.route("**/api/driver/device", async (route) => {
    if (route.request().postDataJSON()?.action === "automatic-register")
      devices++;
    await route.continue();
  });
  await page.route("**/api/driver/offline", async (route) => {
    const action = route.request().postDataJSON()?.action;
    if (action === "register") {
      registrations++;
      await blocked;
    }
    if (action === "post") await route.abort("internetdisconnected");
    else await route.continue();
  });
  try {
    await login(page);
    await expect(
      page.getByText("Preparing trip for offline use...", { exact: true }),
    ).toBeVisible();
    const key = await draft(page, f.customer);
    await expect(save(page)).toBeDisabled();
    await expect(
      deliveryForm(page).getByText("Preparing offline data...", {
        exact: true,
      }),
    ).toBeVisible();
    // An Enter/requestSubmit bypass cannot invoke runtime.submit or reset fields.
    await deliveryForm(page).evaluate((form: HTMLFormElement) =>
      form.requestSubmit(),
    );
    await expect(deliveryForm(page).getByRole("alert")).toHaveText(
      "Offline data is still being prepared. Please wait a moment.",
    );
    await preserved(page, f.customer, key);
    await page.evaluate(() => {
      for (let i = 0; i < 4; i++) {
        window.dispatchEvent(new Event("online"));
        window.dispatchEvent(new Event("focus"));
      }
    });
    await expect.poll(() => registrations).toBe(1);
    expect(devices).toBe(1);
    expect((await f.admin.workspace(f.trip)).visits).toHaveLength(0);
    release();
    await ready(page);
    await preserved(page, f.customer, key);
    await expect(save(page)).toBeEnabled();
    // Online success is bounded by the local commit, while upload is unavailable.
    await save(page).click();
    await expect(
      deliveryForm(page).getByText("Saved on phone", { exact: true }),
    ).toBeVisible({ timeout: 3000 });
    expect((await f.admin.workspace(f.trip)).visits).toHaveLength(0);
    await context.setOffline(true);
    await ready(page);
    await page
      .getByRole("button", { name: "Continue with updated data", exact: true })
      .click();
    await page.locator(`[data-customer-id="${f.customer}"]`).click();
    await page.getByLabel("Jars Delivered", { exact: true }).fill("3");
    await page.getByRole("button", { name: "Credit", exact: true }).click();
    await page
      .getByRole("button", { name: "Review delivery", exact: true })
      .click();
    await expect(save(page)).toBeEnabled();
    await save(page).click();
    await expect(
      deliveryForm(page).getByText("Saved on phone", { exact: true }),
    ).toBeVisible({ timeout: 3000 });
    await expect(page.getByTestId("pending-sync-count")).toHaveText(
      "2 changes saved on this phone",
    );
    await page.unroute("**/api/driver/offline");
    await page.route("**/api/driver/offline", async (route) => {
      if (route.request().postDataJSON()?.action === "register")
        registrations++;
      await route.continue();
    });
    await context.setOffline(false);
    await expect(page.getByText("All synced", { exact: true })).toBeVisible({
      timeout: 45000,
    });
    expect((await f.admin.workspace(f.trip)).visits).toHaveLength(2);
    await page.reload();
    await ready(page);
    expect(registrations).toBe(1);
    expect(devices).toBe(1);
    await page
      .getByRole("navigation")
      .getByRole("link", { name: "My Stock", exact: true })
      .click();
    await expect(page.getByTestId("driver-remaining-full-jars")).toHaveText(
      "90",
    );
  } finally {
    release();
  }
});

test("authorization failure preserves the draft, waits for Retry, and reuses the preparation", async ({
  page,
  context,
  request,
}) => {
  const f = await activeFixtureTrip(request, 100, 10);
  const day = (await f.admin.workspace()).days.find(
    (d) => d.status === "OPEN",
  )!.id;
  await f.admin.rpc("adjust_customer_custody", {
    p_customer: f.customer,
    p_product: fixtureIds.jar,
    p_delta: 10,
    p_day: day,
    p_reason: "Verified opening jars for draft preservation",
    p_key: randomUUID(),
  });
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  let attempts = 0;
  const deviceIds: string[] = [];
  await page.route("**/api/driver/device", async (route) => {
    if (route.request().postDataJSON()?.action === "automatic-register")
      deviceIds.push(route.request().postDataJSON().device);
    await route.continue();
  });
  await page.route("**/api/driver/offline", async (route) => {
    if (
      route.request().postDataJSON()?.action === "register" &&
      ++attempts === 1
    ) {
      await blocked;
      await route.fulfill({
        status: 403,
        json: { code: "AUTHORIZATION", message: "Fixture registration denied" },
      });
    } else await route.continue();
  });
  try {
    await login(page);
    const key = await draft(page, f.customer);
    release();
    await expect(
      page.getByText("Could not prepare offline access", { exact: true }),
    ).toBeVisible();
    await expect(save(page)).toBeDisabled();
    await expect(
      deliveryForm(page).getByText("Offline data is not ready. Retry above.", {
        exact: true,
      }),
    ).toBeVisible();
    await preserved(page, f.customer, key);
    await context.setOffline(true);
    await expect(
      page
        .getByTestId("driver-sync-status")
        .getByText("Offline", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(
      page.getByText("Could not prepare offline access", { exact: true }),
    ).toBeVisible();
    await preserved(page, f.customer, key);
    expect(attempts).toBe(1);
    expect(deviceIds).toHaveLength(1);
    // A normal online refresh must leave FAILED and its draft visible.
    const refreshed = page.waitForResponse(
      (response) =>
        response.url().includes("/api/driver/workspace") && response.ok(),
    );
    await context.setOffline(false);
    await refreshed;
    await expect(
      page.getByText("Could not prepare offline access", { exact: true }),
    ).toBeVisible();
    expect(attempts).toBe(1);
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await ready(page);
    await preserved(page, f.customer, key);
    await expect(save(page)).toBeEnabled();
    expect(attempts).toBe(2);
    expect(deviceIds).toHaveLength(2);
    expect(deviceIds[1]).toBe(deviceIds[0]);
    await save(page).click();
    await expect(
      deliveryForm(page).getByText("Saved on phone", { exact: true }),
    ).toBeVisible({ timeout: 3000 });
    await expect(page.getByText("All synced", { exact: true })).toBeVisible({
      timeout: 30000,
    });
    const workspace = await f.admin.workspace(f.trip);
    expect(workspace.visits).toHaveLength(1);
    expect(workspace.visits[0]!.notes).toBe("");
  } finally {
    release();
  }
});
