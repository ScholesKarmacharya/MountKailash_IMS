import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { activeFixtureTrip } from "../operations-e2e/fixture-client";

test("driver home fits small phones, tablets and desktop with reachable actions", async ({
  page,
  request,
}, info) => {
  await activeFixtureTrip(request);
  await page.goto("/sign-in?reauth=1");
  await page.getByRole("button", { name: "English", exact: true }).click();
  await page.getByLabel("Email address").fill("driver@fixture.example");
  await page.getByLabel("Password", { exact: true }).fill("fixture-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/driver/home");
  await page.getByRole("button", { name: "English", exact: true }).click();
  await expect(page.getByText("Offline ready", { exact: true })).toBeVisible({
    timeout: 30000,
  });
  mkdirSync("test-results/mobile-ui", { recursive: true });
  await expect(page.locator('meta[name="viewport"]')).toHaveAttribute(
    "content",
    /interactive-widget=resizes-content/,
  );
  for (const width of [360, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      )
      .toBe(true);
    const header = await page.getByTestId("driver-header").boundingBox();
    expect(header!.height).toBeLessThan(90);
    await expect(
      page.getByTestId("driver-bottom-nav").getByRole("link"),
    ).toHaveCount(5);
    const action = page.getByRole("link", {
      name: "New Delivery",
      exact: true,
    });
    await action.scrollIntoViewIfNeeded();
    const button = await action.boundingBox();
    const nav = await page.getByTestId("driver-bottom-nav").boundingBox();
    expect(button!.height).toBeGreaterThanOrEqual(44);
    if (width < 1024)
      expect(button!.y + button!.height).toBeLessThanOrEqual(nav!.y);
    await page.screenshot({
      path: `test-results/mobile-ui/${info.project.name}-${width}-home.png`,
      fullPage: true,
    });
  }
});
