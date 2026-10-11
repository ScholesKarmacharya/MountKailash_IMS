import { expect, test } from "@playwright/test";
test("sign-in explains missing configuration and has accessible fields", async ({
  page,
}) => {
  await page.goto("/sign-in");
  await expect(
    page.getByRole("heading", { name: "Welcome back" }),
  ).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Setup required");
  await expect(page.getByLabel("Email address")).toBeDisabled();
  await expect(page.getByLabel("Password", { exact: true })).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeDisabled();
});
for (const route of ["/admin", "/admin/dashboard", "/driver", "/driver/home"])
  test(`unauthenticated direct ${route} access is guarded`, async ({
    page,
  }) => {
    await page.goto(route);
    await expect(page).toHaveURL(/\/sign-in/);
    await expect(
      page.getByRole("heading", { name: "Welcome back" }),
    ).toBeVisible();
  });
