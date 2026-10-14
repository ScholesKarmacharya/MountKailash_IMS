import { test, expect } from "@playwright/test";

// Existing authorized admin; read only. Never submit a production trip form.
test("hosted schema renders the scheduled-trip form after migration", async ({
  page,
}) => {
  const email = process.env.DEMO_ADMIN_EMAIL ?? "admin@mount-kailash.example";
  const password = process.env.DEMO_ADMIN_PASSWORD;
  expect(
    password,
    "Existing admin diagnostic credentials are required",
  ).toBeTruthy();
  await page.goto("/sign-in");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password!);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/admin/dashboard");
  const response = await page.goto("/admin/trips");
  expect(response?.status()).toBe(200);
  await expect(
    page.getByRole("heading", { name: "Create trip", exact: true }),
  ).toBeVisible();
  const form = page.locator("form").filter({
    has: page.getByRole("button", { name: "Create draft trip", exact: true }),
  });
  await expect(form.locator('input[name="scheduled"]')).toHaveValue(
    /\d{4}-\d{2}-\d{2}/,
  );
  await expect(form.getByLabel("Driver", { exact: true })).toBeVisible();
  await expect(form.getByLabel("Vehicle", { exact: true })).toBeVisible();
  await expect(
    form.getByRole("button", { name: "Create draft trip", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Unable to save this operation.", { exact: false }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Install the operations migration", { exact: false }),
  ).toHaveCount(0);
});
