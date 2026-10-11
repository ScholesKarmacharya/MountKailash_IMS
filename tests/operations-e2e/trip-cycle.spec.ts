import { expect, test, type Page } from "@playwright/test";
async function login(page: Page, role = "admin") {
  await page.goto("/sign-in");
  await page.getByLabel("Email address").fill(`${role}@fixture.example`);
  await page.getByLabel("Password", { exact: true }).fill("fixture-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(
    role === "admin" ? /admin\/dashboard/ : /driver\/home/,
  );
}
async function save(page: Page, label: string) {
  await page.getByRole("button", { name: label, exact: true }).click();
  await expect(
    page.getByText("Saved to the database.", { exact: true }),
  ).toBeVisible();
}
async function updated(page: Page, reload = false) {
  if (reload)
    await page
      .getByRole("button", { name: "Continue with updated data", exact: true })
      .click();
  await page.waitForLoadState("domcontentloaded");
}
test("real SQL physical trip cycle through admin and mobile driver screens", async ({
  page,
  request,
}) => {
  await request.post("http://127.0.0.1:17777/reset");
  page.on("dialog", (d) => d.accept());
  await login(page);
  await page.goto("/admin/customers");
  await page
    .getByLabel("Customer name", { exact: true })
    .fill("Browser Customer");
  await page.getByLabel("Shop / business").fill("Browser Shop");
  await page.getByLabel("Reason for this change").fill("Browser test customer");
  await save(page, "Create customer");
  await page.goto("/admin/vehicles");
  await page.getByLabel("Number plate").fill("TEST-BROWSER");
  await page.getByLabel("Reason for this change").fill("Browser test vehicle");
  await save(page, "Register vehicle");
  await page.goto("/admin/trips");
  await page
    .getByLabel("Driver", { exact: true })
    .selectOption({ label: "Fixture driver" });
  await page
    .getByLabel("Vehicle", { exact: true })
    .selectOption({ label: "TEST-BROWSER" });
  await page.getByRole("checkbox", { name: /Browser Customer/ }).check();
  await save(page, "Create draft trip");
  await page
    .getByRole("link", { name: "Open saved trip", exact: true })
    .click();
  await expect(page).toHaveURL(/\/admin\/trips\/[0-9a-f-]+$/);
  const tripPath = new URL(page.url()).pathname;
  await page
    .getByRole("checkbox", { name: "20L test jar", exact: true })
    .check();
  await page.getByLabel("20L test jar load", { exact: true }).fill("100");
  await page
    .getByRole("checkbox", { name: "Test water carton", exact: true })
    .check();
  await page.getByLabel("Test water carton load", { exact: true }).fill("10");
  await save(page, "Confirm warehouse loading");
  await updated(page);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/sign-in/);
  await login(page, "driver");
  await save(page, "Start trip");
  await page.getByRole("link", { name: "View trip / return counts" }).click();
  for (const [full, empty] of [
    [40, 30],
    [40, 35],
  ]) {
    await page.getByRole("button", { name: /Browser Customer/ }).click();
    await page
      .getByRole("button", {
        name: "Increase Full jars delivered",
        exact: true,
      })
      .click();
    await expect(
      page.getByLabel("Full jars delivered", { exact: true }),
    ).toHaveValue("1");
    await page
      .getByRole("button", {
        name: "Decrease Full jars delivered",
        exact: true,
      })
      .click();
    await page
      .getByLabel("Full jars delivered", { exact: true })
      .fill(String(full));
    await page
      .getByLabel("Empty jars collected", { exact: true })
      .fill(String(empty));
    await page
      .getByRole("button", { name: "Review delivery", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Correct quantities", exact: true })
      .click();
    await expect(
      page.getByLabel("Full jars delivered", { exact: true }),
    ).toHaveValue(String(full));
    await page
      .getByRole("button", { name: "Review delivery", exact: true })
      .click();
    await save(page, "Save confirmed delivery");
    await updated(page, true);
  }
  await expect(
    page.getByText("Browser Customer · 2 visits", { exact: true }),
  ).toBeVisible();
  const fullInput = page.getByLabel("Full jars delivered", { exact: true });
  await fullInput.fill("21");
  await expect(fullInput).not.toHaveValue("21");
  await save(page, "Submit trip counts");
  await updated(page);
  await expect(
    page.getByText("Awaiting warehouse verification", { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/sign-in/);
  await login(page, "other");
  await page.goto(tripPath.replace("/admin/", "/driver/"));
  await expect(page.getByRole("heading", { name: /not found/i })).toBeVisible();
  await page.goto("/admin/trips");
  await expect(page).toHaveURL(/driver\/home/);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/sign-in/);
  await login(page);
  await page.goto(tripPath);
  await page
    .getByLabel("Verification / discrepancy reason", { exact: true })
    .fill("Counts physically verified");
  await save(page, "Post physical verification");
  await updated(page);
  await expect(
    page.getByRole("heading", { name: "Physical trip closed", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText("Browser Customer · 2 visits", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/TRIP RETURN/)).toHaveCount(3);
  await page.goto("/admin/inventory");
  await expect(page.getByText("20", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("65", { exact: true }).first()).toBeVisible();
});
