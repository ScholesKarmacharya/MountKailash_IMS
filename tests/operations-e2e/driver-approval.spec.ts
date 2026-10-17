import { test, expect, type Page, type Locator } from "@playwright/test";
import { randomUUID } from "node:crypto";
import {
  activeFixtureTrip,
  fixtureClient,
  openAdminMenuForSignOut,
} from "./fixture-client";
import { message } from "../../src/lib/i18n/messages";
import { formatBusinessDate } from "../../src/domain/localization/calendar";
import type { DriverAccount } from "../../src/domain/auth/accounts";
const pendingId = "00000000-0000-0000-0000-000000000004";
async function login(page: Page, role: string, home: RegExp) {
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "English", exact: true }).click();
  await page.getByLabel("Email address").fill(`${role}@fixture.example`);
  await page.getByLabel("Password", { exact: true }).fill("fixture-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(home);
}
async function english(page: Page) {
  const saved = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/preferences") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "English", exact: true }).click();
  expect((await saved).ok()).toBe(true);
  await expect(
    page.getByRole("button", { name: "English", exact: true }),
  ).toBeEnabled();
}
const accountForm = (page: Page, operation: string) =>
  page.locator(
    `form:has(input[name="operation"][value="account:${operation}"])`,
  );
async function saved(
  form: ReturnType<typeof accountForm>,
  label: string,
  completed?: Locator,
) {
  await form.getByRole("button", { name: label, exact: true }).click();
  if (completed) await expect(completed).toBeVisible();
  else await expect(form.getByRole("status")).toContainText("Record saved.");
}
test("pending registration, admin approval, actual names, suspension and reactivation preserve business records", async ({
  page,
  browser,
  request,
}) => {
  const { admin, trip } = await activeFixtureTrip(request, 10, 2);
  const beforeFinance = JSON.stringify(
    await admin.rpc("finance_workspace", {}),
  );
  const beforeStock = JSON.stringify((await admin.workspace(trip)).balances);
  page.on("dialog", (d) => d.accept());
  await login(page, "pending", /\/account$/);
  await expect(
    page.getByRole("heading", {
      name: message("ne", "Waiting for Admin Approval"),
      exact: true,
    }),
  ).toBeVisible();
  await english(page);
  const own = accountForm(page, "profile");
  await own.getByLabel("Full name").fill("Ram Thapa");
  await own.getByLabel("Phone (optional)").fill("9800000000");
  await saved(
    own,
    "Save profile",
    page.getByText("Ram Thapa", { exact: true }),
  );
  await page.reload();
  await expect(page.getByText("Ram Thapa", { exact: true })).toBeVisible();
  for (const route of [
    "/driver/home",
    "/driver/delivery",
    "/driver/customers",
    "/driver/pending-jars",
    "/driver/return",
    "/driver/sales",
    "/admin/drivers",
  ]) {
    await page.goto(route);
    await expect(page).toHaveURL(/\/account$/);
  }
  const context = await browser.newContext({ viewport: page.viewportSize()! });
  const adminPage = await context.newPage();
  adminPage.on("dialog", (d) => d.accept());
  try {
    await login(adminPage, "admin", /admin\/dashboard/);
    await expect(adminPage.getByTestId("profile-name")).toHaveText(
      "Fixture admin",
    );
    await adminPage.goto("/admin/drivers");
    await expect(
      adminPage.getByRole("heading", { name: "Ram Thapa", exact: true }),
    ).toBeVisible();
    await expect(
      adminPage.getByTestId(`driver-card-${pendingId}`),
    ).toContainText("9800000000");
    await adminPage.goto(`/admin/drivers/${pendingId}`);
    await expect(
      adminPage.getByText("pending@fixture.example", { exact: true }),
    ).toBeVisible();
    await expect(
      adminPage.getByText("Pending Approval", { exact: true }),
    ).toBeVisible();
    const status = accountForm(adminPage, "status");
    await status
      .getByLabel("Reason for this change")
      .fill("Reviewed driver identity");
    await saved(
      status,
      "Approve Driver",
      adminPage.getByText("Approved", { exact: true }),
    );
    await adminPage.reload();
    await expect(
      adminPage.getByText("Approved", { exact: true }),
    ).toBeVisible();
    const record = (
      await admin.rpc<DriverAccount[]>("admin_driver_directory", {})
    ).find((d) => d.id === pendingId)!;
    await expect(
      adminPage
        .getByText("Approval date", { exact: true })
        .locator("..")
        .getByText(formatBusinessDate(record.approved_at!, "en", true), {
          exact: true,
        }),
    ).toBeVisible();
    await page
      .getByRole("link", { name: "Check approval status", exact: true })
      .click();
    await expect(page).toHaveURL(/driver\/home/);
    await expect(page.getByTestId("profile-name")).toHaveText("Ram Thapa");
    for (const name of [
      "My Stock",
      "New Sale",
      "Customers",
      "Sales History",
      "More",
    ])
      await expect(
        page.getByRole("navigation").getByRole("link", { name, exact: true }),
      ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.goto("/account/profile");
    const edit = accountForm(page, "profile");
    await edit.getByLabel("Full name").fill("Ram Bahadur Thapa");
    await saved(edit, "Save profile");
    await page.goto("/driver/home");
    await expect(page.getByTestId("profile-name")).toHaveText(
      "Ram Bahadur Thapa",
    );
    await page.reload();
    await expect(page.getByTestId("profile-name")).toHaveText(
      "Ram Bahadur Thapa",
    );
    await adminPage.reload();
    const suspend = accountForm(adminPage, "status");
    await suspend
      .getByLabel("Reason for this change")
      .fill("Temporary access review");
    await saved(
      suspend,
      "Suspend Driver",
      adminPage.getByText("Suspended", { exact: true }),
    );
    // Same browser session, with no fresh authentication: current DB status wins.
    await page.goto("/driver/customers");
    await expect(page).toHaveURL(/\/account$/);
    await expect(
      page.getByRole("heading", { name: "Suspended", exact: true }),
    ).toBeVisible();
    await adminPage.reload();
    const reactivate = accountForm(adminPage, "status");
    await reactivate
      .getByLabel("Reason for this change")
      .fill("Review completed");
    await saved(
      reactivate,
      "Reactivate Driver",
      adminPage.getByText("Approved", { exact: true }),
    );
    await page
      .getByRole("link", { name: "Check approval status", exact: true })
      .click();
    await expect(page).toHaveURL(/driver\/home/);
    const preference = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/preferences") && r.request().method() === "POST",
    );
    await page.getByRole("button", { name: "नेपाली", exact: true }).click();
    expect((await preference).ok()).toBe(true);
    await expect(
      page
        .getByTestId("driver-bottom-nav")
        .getByRole("link", { name: message("ne", "My Stock"), exact: true }),
    ).toBeVisible();
    await expect(
      page
        .getByRole("navigation")
        .getByRole("link", { name: message("ne", "New Sale"), exact: true }),
    ).toBeVisible();
    await expect(page.getByTestId("profile-name")).toHaveText(
      "Ram Bahadur Thapa",
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    // Fixture-only authenticated workspace: no real credentials/data in artifacts.
    await page.screenshot({
      path: `test-results/driver-approval-${page.viewportSize()!.width}px.png`,
    });
    await openAdminMenuForSignOut(page);
    await page
      .getByRole("button", { name: message("ne", "Sign Out"), exact: true })
      .click();
    await expect(page).toHaveURL(/sign-in/);
    await page.goto("/driver/home");
    await expect(page).toHaveURL(/sign-in/);
    await adminPage.goto("/account/profile");
    const adminEdit = accountForm(adminPage, "profile");
    await adminEdit.getByLabel("Full name").fill("Sita Adhikari");
    await saved(adminEdit, "Save profile");
    await adminPage.goto("/admin/dashboard");
    await expect(adminPage.getByTestId("profile-name")).toHaveText(
      "Sita Adhikari",
    );
    await adminPage.reload();
    await expect(adminPage.getByTestId("profile-name")).toHaveText(
      "Sita Adhikari",
    );
    await openAdminMenuForSignOut(adminPage);
    await adminPage
      .getByRole("button", { name: "Sign Out", exact: true })
      .click();
    await expect(adminPage).toHaveURL(/sign-in/);
    await adminPage.goto("/admin/drivers");
    await expect(adminPage).toHaveURL(/sign-in/);
    expect(JSON.stringify(await admin.rpc("finance_workspace", {}))).toBe(
      beforeFinance,
    );
    expect(JSON.stringify((await admin.workspace(trip)).balances)).toBe(
      beforeStock,
    );
  } finally {
    await context.close();
  }
});
test("admin creation defaults pending, rejection is visible and sign-out outages safely clear local access", async ({
  page,
  request,
}) => {
  expect((await request.post("http://127.0.0.1:17777/reset")).ok()).toBe(true);
  const admin = await fixtureClient(request);
  page.on("dialog", (d) => d.accept());
  await login(page, "admin", /admin\/dashboard/);
  await page.goto("/admin/drivers");
  await page.getByRole("button", { name: "Add driver", exact: true }).click();
  const add = accountForm(page, "driver");
  await add.getByLabel("Existing Supabase Auth user UUID").fill(pendingId);
  await add.getByLabel("Full name").fill("New Driver");
  await expect(add.getByLabel("Approval on creation")).toHaveValue("false");
  await add
    .getByLabel("Reason for this change")
    .fill("Review newly provisioned account");
  await saved(add, "Create pending driver");
  await page.goto(`/admin/drivers/${pendingId}`);
  const review = accountForm(page, "status");
  await review
    .getByRole("button", { name: "Select rejection", exact: true })
    .click();
  await review
    .getByLabel("Reason for this change")
    .fill("Awaiting identity verification");
  await saved(
    review,
    "Reject Driver",
    page.getByText("Rejected", { exact: true }),
  );
  await openAdminMenuForSignOut(page);
  await page.getByRole("button", { name: "Sign Out", exact: true }).click();
  await expect(page).toHaveURL(/sign-in/);
  await login(page, "pending", /\/account$/);
  await expect(
    page.getByRole("heading", { name: message("ne", "Rejected"), exact: true }),
  ).toBeVisible();
  await english(page);
  const account = (
    await admin.rpc<DriverAccount[]>("admin_driver_directory", {})
  ).find((d) => d.id === pendingId)!;
  await admin.rpc("change_driver_status", {
    p_id: pendingId,
    p_status: "APPROVED",
    p_version: account.version,
    p_reason: "Identity verified",
    p_key: randomUUID(),
  });
  await page
    .getByRole("link", { name: "Check approval status", exact: true })
    .click();
  await expect(page).toHaveURL(/driver\/home/);
  expect(
    (await request.post("http://127.0.0.1:17777/logout-failure")).ok(),
  ).toBe(true);
  await openAdminMenuForSignOut(page);
  await page.getByRole("button", { name: "Sign Out", exact: true }).click();
  await expect(page).toHaveURL(/sign-in\?reason=signout/);
  await expect(page.getByRole("status")).toContainText(
    "You are signed out on this device.",
  );
  await page.goto("/driver/delivery");
  await expect(page).toHaveURL(/sign-in/);
  await login(page, "pending", /driver\/home/);
  await openAdminMenuForSignOut(page);
  await page.getByRole("button", { name: "Sign Out", exact: true }).click();
  await expect(page).toHaveURL(/sign-in/);
  await page.goto("/driver/delivery");
  await expect(page).toHaveURL(/sign-in/);
});
