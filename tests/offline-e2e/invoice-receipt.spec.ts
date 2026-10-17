import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import {
  activeFixtureTrip,
  fixtureIds,
  saveDriverRecord,
} from "../operations-e2e/fixture-client";
import type { FinanceWorkspace } from "../../src/domain/finance/types";

async function login(page: Page) {
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "English", exact: true }).click();
  await page.getByLabel("Email address").fill("driver@fixture.example");
  await page.getByLabel("Password", { exact: true }).fill("fixture-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/driver/home");
  await page.getByRole("button", { name: "English", exact: true }).click();
  page.on("dialog", (d) => d.accept());
}

test("registered invoice receipts use the durable writer offline, survive refresh and keep Fonepay pending", async ({
  page,
  request,
  context,
}) => {
  const f = await activeFixtureTrip(request);
  await f.driver.rpc("post_driver_delivery", {
    p_trip: f.trip,
    p_customer: f.customer,
    p_walk_name: "",
    p_walk_phone: "",
    p_items: [
      { product_id: fixtureIds.jar, full_jars: 2, empty_jars: 0, cartons: 0 },
    ],
    p_status: "CREDIT",
    p_received: null,
    p_notes: "",
    p_key: randomUUID(),
  });
  const finance = () => f.admin.rpc<FinanceWorkspace>("finance_workspace", {});
  const invoice = (await finance()).invoices[0]!;
  await login(page);
  await expect(page.getByText("Offline ready", { exact: true })).toBeVisible({
    timeout: 30000,
  });
  await page.goto(`/driver/invoices/${invoice.id}`);
  await expect(page.getByText("Offline ready", { exact: true })).toBeVisible({
    timeout: 30000,
  });
  await context.setOffline(true);
  await expect(
    page
      .getByTestId("driver-header")
      .getByRole("img", { name: "Offline", exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Invoice amount received (NPR)", { exact: true })
    .fill("50");
  await saveDriverRecord(page, "Record invoice receipt");
  expect((await finance()).payments).toHaveLength(0);
  await context.setOffline(false);
  await expect.poll(async () => (await finance()).payments.length).toBe(1);
  let confirmed = await finance();
  expect(confirmed.invoices[0]).toMatchObject({
    outstanding: "250.50",
    available: "250.50",
  });
  expect(confirmed.payments[0]).toMatchObject({
    method: "CASH",
    amount: "50.00",
    status: "CONFIRMED",
  });
  await page
    .getByRole("button", { name: "Continue with updated data", exact: true })
    .click();
  await expect(
    page.getByText("Outstanding: NPR 250.50", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Offline ready", { exact: true })).toBeVisible({
    timeout: 30000,
  });
  await page
    .getByLabel("Invoice amount received (NPR)", { exact: true })
    .fill("25");
  await page
    .getByRole("button", { name: "Fonepay pending", exact: true })
    .click();
  await saveDriverRecord(page, "Record invoice receipt");
  await expect.poll(async () => (await finance()).payments.length).toBe(2);
  confirmed = await finance();
  expect(confirmed.invoices[0]).toMatchObject({
    outstanding: "250.50",
    available: "225.50",
  });
  expect(confirmed.payments.find((p) => p.method === "FONEPAY")).toMatchObject({
    amount: "25.00",
    status: "PENDING",
  });
  await page.reload();
  expect((await finance()).payments).toHaveLength(2);
  expect((await f.admin.workspace(f.trip)).visits).toHaveLength(1);
});
