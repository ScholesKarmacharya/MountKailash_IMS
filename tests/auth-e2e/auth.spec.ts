import { expect, test } from "@playwright/test";
for (const role of ["ADMIN", "DRIVER"] as const) {
  test(`${role} sign-in redirects, shell is usable and sign-out revokes access`, async ({
    page,
  }) => {
    await page.goto("/sign-in");
    await page
      .getByLabel("Email address")
      .fill(`${role.toLowerCase()}@mount-kailash.example`);
    await page
      .getByLabel("Password", { exact: true })
      .fill(process.env[`DEMO_${role}_PASSWORD`]!);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(
      role === "ADMIN" ? /\/admin\/dashboard/ : /\/driver\/home/,
    );
    await expect(page.getByRole("navigation")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    if (role === "DRIVER") {
      await page.goto("/admin/dashboard");
      await expect(page).toHaveURL(/\/driver\/home/);
      await expect(
        page.getByRole("button", { name: /New visit/ }),
      ).toBeDisabled();
    } else {
      await expect(
        page.getByText("Not yet available", { exact: true }),
      ).toHaveCount(3);
    }
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(page).toHaveURL(/\/sign-in/);
    await page.goto(role === "ADMIN" ? "/admin/dashboard" : "/driver/home");
    await expect(page).toHaveURL(/\/sign-in/);
  });
}
