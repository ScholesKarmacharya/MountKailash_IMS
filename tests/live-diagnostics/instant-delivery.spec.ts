import { test, expect, type Page } from "@playwright/test";
// Existing authorized accounts, read-only business views. Never save a sale,
// return, payment, stock allocation or fixture against the linked project.
async function login(page: Page, role: "ADMIN" | "DRIVER") {
  await page.route("**/api/preferences", (route) =>
    route.fulfill({ json: { locale: "en" } }),
  );
  await page.goto("/sign-in");
  await page
    .getByLabel("Email address")
    .fill(
      process.env[`DEMO_${role}_EMAIL`] ??
        `${role.toLowerCase()}@mount-kailash.example`,
    );
  const password = process.env[`DEMO_${role}_PASSWORD`];
  expect(
    password,
    "Existing diagnostic account credentials are required",
  ).toBeTruthy();
  await page.getByLabel("Password", { exact: true }).fill(password!);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(
    role === "ADMIN" ? "**/admin/dashboard" : "**/driver/home",
  );
  await page.getByRole("button", { name: "English", exact: true }).click();
}
test("hosted driver with confirmed active stock opens the instant form after forward migration", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await login(page, "DRIVER");
  const navigation = page.getByRole("navigation", {
    name: "Driver navigation",
    exact: true,
  });
  const labels = await navigation.getByRole("link").allTextContents();
  expect(labels.findIndex((label) => label.trim() === "Instant Delivery")).toBe(
    labels.findIndex((label) => label.trim() === "New Sale") + 1,
  );
  await navigation
    .getByRole("link", { name: "Instant Delivery", exact: true })
    .click();
  await expect(page.getByTestId("instant-form")).toBeVisible({
    timeout: 30000,
  });
  await expect(
    page.getByText(
      "Instant Delivery requires a database update. Contact the admin.",
      { exact: true },
    ),
  ).toHaveCount(0);
  await expect(
    page.getByText("No active delivery trip. Please contact the warehouse.", {
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /Admin Approval|Approve Instant/ }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  for (const size of await navigation.getByRole("link").evaluateAll((nodes) =>
    nodes.map((n) => ({
      width: n.getBoundingClientRect().width,
      height: n.getBoundingClientRect().height,
    })),
  )) {
    expect(size.width).toBeGreaterThanOrEqual(44);
    expect(size.height).toBeGreaterThanOrEqual(44);
  }
  await page.getByRole("button", { name: "नेपाली", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "तत्काल डेलिभरी", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
test("hosted admin instant dashboard uses installed real records and vehicle filtering", async ({
  page,
}) => {
  await login(page, "ADMIN");
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "Instant Deliveries", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Instant Deliveries", exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("Total Instant Deliveries")).toHaveText(
    /^\d+$/,
  );
  await expect(page.getByLabel("Vehicle", { exact: true })).toBeVisible();
  await expect(page.getByTestId("Outstanding Credit")).toContainText("NPR");
  await expect(
    page.getByText(
      "Instant Delivery requires a database update. Contact the admin.",
      { exact: true },
    ),
  ).toHaveCount(0);
});
