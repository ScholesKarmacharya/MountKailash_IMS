import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { activeFixtureTrip, fixtureIds } from "./fixture-client";

test("refresh blocks a delivery draft that now exceeds vehicle stock", async ({
  page,
  request,
}) => {
  const { driver, customer, trip } = await activeFixtureTrip(request);
  page.on("dialog", (d) => d.accept());
  await page.goto("/sign-in");
  await page.getByLabel("Email address").fill("driver@fixture.example");
  await page.getByLabel("Password", { exact: true }).fill("fixture-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/driver\/home/);
  await page.getByRole("button", { name: "English", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "English", exact: true }),
  ).toBeEnabled();
  await page.goto(`/driver/trips/${trip}`);
  await page
    .getByRole("button", { name: "Refresh customer", exact: true })
    .click();
  await page.getByLabel("Full jars delivered", { exact: true }).fill("90");
  // Another signed-in device posts 40 while this browser retains an unsaved 90.
  await driver.rpc("post_trip_visit", {
    p_trip: trip,
    p_customer: customer,
    p_walk_name: "",
    p_walk_phone: "",
    p_items: [
      { product_id: fixtureIds.jar, full_jars: 40, empty_jars: 0, cartons: 0 },
    ],
    p_payment: { selection: "CASH" },
    p_notes: "Other device",
    p_key: randomUUID(),
  });
  await page
    .getByRole("button", { name: "Refresh stock", exact: true })
    .click();
  const full = page.getByLabel("Full jars delivered", { exact: true });
  await expect(full).toHaveAttribute("max", "60");
  await expect(full).toHaveValue("90");
  await expect(
    page.getByRole("button", { name: "Review delivery", exact: true }),
  ).toBeDisabled();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "exceeds the remaining vehicle stock" }),
  ).toBeVisible();
  await full.fill("60");
  await expect(
    page.getByRole("button", { name: "Review delivery", exact: true }),
  ).toBeEnabled();
});
