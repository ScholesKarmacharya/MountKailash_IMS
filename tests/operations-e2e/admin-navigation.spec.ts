import { test, expect, type Page } from "@playwright/test";
import { activeFixtureTrip } from "./fixture-client";
async function login(page: Page, role = "admin") {
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "English", exact: true }).click();
  await page.getByLabel("Email address").fill(`${role}@fixture.example`);
  await page.getByLabel("Password", { exact: true }).fill("fixture-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(
    role === "admin" ? /admin\/dashboard/ : /driver\/home/,
  );
  await page.getByRole("button", { name: "English", exact: true }).click();
}
test("responsive admin navigation, focus, backdrop, route highlight, notifications, locale and logout", async ({
  page,
  request,
}, info) => {
  const f = await activeFixtureTrip(request, 20),
    failures: string[] = [];
  page.on("pageerror", (e) => failures.push(e.message));
  await login(page);
  const trigger = page.getByTestId("admin-menu-button"),
    sidebar = page.getByTestId("admin-desktop-sidebar"),
    drawer = page.getByTestId("admin-mobile-drawer"),
    navbar = page.getByTestId("admin-navbar"),
    width = page.viewportSize()!.width;
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  if (width >= 1024) {
    await expect(sidebar).toBeVisible();
    await expect(trigger).not.toBeVisible();
    await expect(sidebar.getByRole("link")).toHaveCount(17);
    await page.goto(`/admin/trips/${f.trip}`);
    await expect(
      sidebar.getByRole("link", { name: "Trips", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await page.setViewportSize({ width: 1023, height: 768 });
    await trigger.click();
    await expect(drawer).toBeVisible();
    await page.setViewportSize({ width: 1024, height: 768 });
    await expect(drawer).not.toBeVisible();
    expect(await page.evaluate(() => document.body.style.overflow)).not.toBe(
      "hidden",
    );
  } else {
    await expect(sidebar).not.toBeVisible();
    await expect(trigger).toBeVisible();
    const navBox = (await navbar.boundingBox())!,
      main = (await page.getByRole("main").boundingBox())!;
    expect(navBox.height).toBeLessThan(90);
    expect(main.y).toBeGreaterThanOrEqual(navBox.y + navBox.height);
    expect(main.y - navBox.y - navBox.height).toBeLessThan(32);
    await trigger.click();
    await expect(drawer).toBeVisible();
    await expect(
      drawer
        .getByRole("navigation", { name: "Admin navigation", exact: true })
        .getByRole("link"),
    ).toHaveCount(17);
    await expect(
      drawer.getByRole("link", { name: "Overview", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    const box = (await drawer.boundingBox())!;
    expect(box.width).toBeLessThan(width);
    expect(box.x).toBe(0);
    expect(box.height).toBe(page.viewportSize()!.height);
    expect(await page.evaluate(() => document.body.style.overflow)).toBe(
      "hidden",
    );
    for (let i = 0; i < 23; i++) {
      await page.keyboard.press("Tab");
      expect(
        await drawer.evaluate((el) => el.contains(document.activeElement)),
      ).toBe(true);
    }
    await page.keyboard.press("Shift+Tab");
    expect(
      await drawer.evaluate((el) => el.contains(document.activeElement)),
    ).toBe(true);
    expect(
      await page.evaluate(() => {
        const main = document.querySelector("main")!;
        main.setAttribute("tabindex", "-1");
        main.focus();
        const trapped = document
          .querySelector("dialog[open]")!
          .contains(document.activeElement);
        main.removeAttribute("tabindex");
        return trapped;
      }),
    ).toBe(true);
    await drawer.screenshot({
      path: `test-results/admin-drawer-${info.project.name}.png`,
      scale: "css",
    });
    await page.keyboard.press("Escape");
    await expect(drawer).not.toBeVisible();
    await expect(trigger).toBeFocused();
    expect(await page.evaluate(() => document.body.style.overflow)).not.toBe(
      "hidden",
    );
    await trigger.click();
    await page.mouse.click(width - 5, 120);
    await expect(drawer).not.toBeVisible();
    await trigger.click();
    await drawer
      .getByRole("button", { name: "Close admin menu", exact: true })
      .click();
    await expect(drawer).not.toBeVisible();
    await trigger.click();
    await drawer
      .getByRole("link", { name: "Daily history", exact: true })
      .click();
    await expect(page).toHaveURL(/admin\/reports/);
    await expect(drawer).not.toBeVisible();
    await trigger.click();
    await expect(
      drawer.getByRole("link", { name: "Daily history", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await page.keyboard.press("Escape");
    await page.goto(`/admin/customers/${f.customer}`);
    await trigger.click();
    await expect(
      drawer.getByRole("link", { name: "Customers", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await page.keyboard.press("Escape");
  }
  await page.getByTestId("notification-bell").click();
  await expect(
    page.getByRole("dialog", { name: "Notifications", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Close notifications", exact: true })
    .click();
  await page.getByRole("button", { name: "नेपाली", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "नेपाली", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await navbar.screenshot({
    path: `test-results/admin-navbar-${info.project.name}-ne.png`,
    scale: "css",
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "English", exact: true }).click();
  await navbar.locator('a[href="/account/profile"]').click();
  await expect(page).toHaveURL(/account\/profile/);
  if (await trigger.isVisible()) await trigger.click();
  await page.getByRole("button", { name: "Sign Out", exact: true }).click();
  await expect(page).toHaveURL(/sign-in/);
  await page.goto("/admin/payments");
  await expect(page).toHaveURL(/sign-in/);
  await login(page, "driver");
  await expect(page.getByTestId("admin-menu-button")).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "New Sale", exact: true }).first(),
  ).toBeVisible();
  expect(failures).toEqual([]);
});
