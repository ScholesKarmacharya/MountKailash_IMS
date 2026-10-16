import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import {
  activeFixtureTrip,
  fixtureIds,
} from "../operations-e2e/fixture-client";

test("one-time contact, sale and later returns survive encrypted offline reopening and sync exactly once", async ({
  page,
  context,
  request,
}, testInfo) => {
  const f = await activeFixtureTrip(request);
  const initial = await f.admin.workspace(f.trip);
  const location = initial.vehicles.find(
    (v) => v.id === initial.trips[0]!.vehicle_id,
  )!.location_id;
  page.on("dialog", (d) => d.accept());
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "English", exact: true }).click();
  await page.getByLabel("Email address").fill("driver@fixture.example");
  await page.getByLabel("Password", { exact: true }).fill("fixture-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/driver\/home/);
  await page.getByRole("button", { name: "English", exact: true }).click();
  await expect(page.getByText("Offline ready", { exact: true })).toBeVisible({
    timeout: 30000,
  });

  await expect(page.getByText("All synced", { exact: true })).toBeVisible({
    timeout: 30000,
  });
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "Instant Delivery", exact: true })
    .click();
  const onlineForm = await page.getByTestId("instant-form").innerText();
  await page.getByRole("button", { name: "नेपाली", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "तत्काल डेलिभरी", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "English", exact: true }).click();
  await context.setOffline(true);
  await expect(
    page
      .getByTestId("driver-sync-status")
      .getByText("Offline", { exact: true }),
  ).toBeVisible();
  expect(await page.getByTestId("instant-form").innerText()).toBe(onlineForm);
  await page
    .getByLabel("Customer or Event Name", { exact: true })
    .fill("Offline Wedding");
  await page.getByLabel("Phone Number", { exact: true }).fill("9801234567");
  await page
    .getByLabel("Delivery Location", { exact: true })
    .fill("Patan event hall");
  await page.getByLabel("Jars Delivered", { exact: true }).fill("20");
  await page.getByLabel("Empty Jars Collected", { exact: true }).fill("15");
  await page
    .getByRole("button", { name: "Review Instant Delivery", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Save Instant Delivery", exact: true })
    .click();
  await expect(page.getByTestId("instant-card")).toContainText(
    "Saved on Device",
  );
  await expect(
    page.getByTestId("instant-pending-jars").locator("strong"),
  ).toHaveText("5");
  expect(
    (await f.admin.rpc<{ records: unknown[] }>("instant_workspace", {}))
      .records,
  ).toHaveLength(0);
  expect(
    (await f.admin.workspace(f.trip)).balances.find(
      (b) =>
        b.location_id === location &&
        b.product_id === fixtureIds.jar &&
        b.stock_kind === "FULL_JAR",
    )!.quantity,
  ).toBe(100);
  await page.reload();
  await page.getByRole("button", { name: "English", exact: true }).click();

  await expect(
    page.getByRole("heading", { name: "Instant Delivery", exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("instant-card")).toContainText(
    "Offline Wedding",
  );
  await page
    .getByTestId("instant-card")
    .getByRole("button", { name: "Open Instant Delivery", exact: true })
    .click();
  await expect(page.getByTestId("instant-history")).toContainText(
    "Saved on Device",
  );
  await expect(
    page
      .getByTestId("instant-history")
      .getByRole("link", { name: "View receipt", exact: true }),
  ).toHaveCount(0);
  await page
    .getByLabel("20L test jar · Empty Jars Collected", { exact: true })
    .fill("5");
  await page
    .getByRole("button", { name: "Collect Empty Jars", exact: true })
    .click();
  await expect(page.getByTestId("instant-history")).toContainText(
    "Jars to Return: 0",
  );
  await expect(page.getByTestId("instant-history")).toContainText(
    "Saved on Device",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `test-results/instant-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await context.setOffline(false);
  await expect(page.getByText("All synced", { exact: true })).toBeVisible({
    timeout: 30000,
  });
  await expect(page.getByTestId("instant-history")).toContainText("Completed");
  const records = (
    await f.admin.rpc<{
      records: { pending: number; returned: number; event_name: string }[];
    }>("instant_workspace", {})
  ).records;
  expect(records).toHaveLength(1);
  expect(records[0]).toMatchObject({
    event_name: "Offline Wedding",
    pending: 0,
    returned: 20,
  });
  const finance = await f.admin.rpc<{
    invoices: unknown[];
    payments: unknown[];
  }>("finance_workspace", {});
  expect(finance.invoices).toHaveLength(1);
  expect(finance.payments).toHaveLength(1);
  const w = await f.admin.workspace(f.trip);
  expect(
    w.balances.find(
      (b) =>
        b.location_id === location &&
        b.product_id === fixtureIds.jar &&
        b.stock_kind === "FULL_JAR",
    )!.quantity,
  ).toBe(80);
  expect(
    w.balances.find(
      (b) =>
        b.location_id === location &&
        b.product_id === fixtureIds.jar &&
        b.stock_kind === "EMPTY_JAR",
    )!.quantity,
  ).toBe(20);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByTestId("instant-history")).toContainText("Completed");
  expect(
    (await f.admin.rpc<{ records: unknown[] }>("instant_workspace", {}))
      .records,
  ).toHaveLength(1);
});

test("offline old-credit collection on an existing event is durable and never creates a second sale", async ({
  page,
  context,
  request,
}) => {
  const f = await activeFixtureTrip(request);
  await f.driver.rpc("post_instant_delivery", {
    p_trip: f.trip,
    p_id: randomUUID(),
    p_name: "Offline Credit Party",
    p_phone: "9801234567",
    p_location: "Lakeside",
    p_items: [
      { product_id: fixtureIds.jar, full_jars: 20, empty_jars: 15, cartons: 0 },
    ],
    p_status: "CREDIT",
    p_received: null,
    p_notes: "",
    p_key: randomUUID(),
  });
  page.on("dialog", (d) => d.accept());
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "English", exact: true }).click();
  await page.getByLabel("Email address").fill("driver@fixture.example");
  await page.getByLabel("Password", { exact: true }).fill("fixture-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/driver\/home/);
  await page.getByRole("button", { name: "English", exact: true }).click();
  await expect(page.getByText("Offline ready", { exact: true })).toBeVisible({
    timeout: 30000,
  });

  await expect(page.getByText("All synced", { exact: true })).toBeVisible({
    timeout: 30000,
  });
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "Instant Delivery", exact: true })
    .click();
  await context.setOffline(true);
  await expect(
    page
      .getByTestId("driver-sync-status")
      .getByText("Offline", { exact: true }),
  ).toBeVisible();
  await page
    .getByTestId("instant-card")
    .getByRole("button", { name: "Open Instant Delivery", exact: true })
    .click();
  await page
    .getByLabel("Credit amount received (NPR)", { exact: true })
    .fill("3005.00");
  await page
    .getByRole("button", { name: "Collect outstanding credit", exact: true })
    .click();
  await expect(page.getByTestId("instant-history")).toContainText(
    "Saved on Device",
  );
  await expect(page.getByTestId("instant-history")).toContainText(
    "Outstanding Payments: NPR 0.00",
  );
  expect(
    (await f.admin.rpc<{ payments: unknown[] }>("finance_workspace", {}))
      .payments,
  ).toHaveLength(0);
  await page.reload();
  await page.getByRole("button", { name: "English", exact: true }).click();

  await page
    .getByTestId("instant-card")
    .getByRole("button", { name: "Open Instant Delivery", exact: true })
    .click();
  await expect(page.getByTestId("instant-history")).toContainText(
    "Saved on Device",
  );
  await context.setOffline(false);
  await expect(page.getByText("All synced", { exact: true })).toBeVisible({
    timeout: 30000,
  });
  await expect(page.getByTestId("instant-history")).toContainText(
    "Pending Return",
  );
  await expect(page.getByTestId("instant-history")).toContainText(
    "Outstanding Payments: NPR 0.00",
  );
  const finance = await f.admin.rpc<{
    sales: unknown[];
    invoices: unknown[];
    payments: unknown[];
  }>("finance_workspace", {});
  expect(finance.sales).toHaveLength(1);
  expect(finance.invoices).toHaveLength(1);
  expect(finance.payments).toHaveLength(1);
  const records = (
    await f.admin.rpc<{ records: { pending: number; outstanding: string }[] }>(
      "instant_workspace",
      {},
    )
  ).records;
  expect(records[0]).toMatchObject({ pending: 5, outstanding: "0.00" });
});
