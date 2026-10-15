import { test, expect, type Page, type Locator } from "@playwright/test";
import { randomUUID } from "node:crypto";
import {
  activeFixtureTrip,
  fixtureIds,
  openAdminMenuForSignOut,
} from "./fixture-client";
import {
  adToBs,
  formatBusinessDate,
  shiftDate,
} from "../../src/domain/localization/calendar";
import type { DriverAccount } from "../../src/domain/auth/accounts";
async function login(page: Page, role = "admin") {
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "English", exact: true }).click();
  await page.getByLabel("Email address").fill(`${role}@fixture.example`);
  await page.getByLabel("Password", { exact: true }).fill("fixture-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(
    role === "admin" ? /admin\/dashboard/ : /driver\/home/,
  );
}
async function save(
  page: Page,
  label: string,
  scope: Locator = page.locator("body"),
) {
  const response = page.waitForResponse(
    (r) =>
      r.request().method() === "POST" && !!r.request().headers()["next-action"],
  );
  await scope.getByRole("button", { name: label, exact: true }).click();
  expect((await response).ok()).toBe(true);
}
async function layout(page: Page, scope: Locator, file: string) {
  await expect(scope).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(await scope.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
    true,
  );
  expect(await page.evaluate(() => window.devicePixelRatio)).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.visualViewport?.scale ?? 1)).toBe(1);
  await scope.screenshot({ path: file, scale: "css" });
}
function errors(page: Page) {
  const list: string[] = [];
  page.on("pageerror", (error) => list.push(error.message));
  page.on("console", (msg) => {
    if (
      msg.type() === "error" &&
      /hydration|cannot be a child|cannot contain|In HTML/.test(msg.text())
    )
      list.push(msg.text());
  });
  return list;
}
async function pick(page: Page, date: string) {
  await page
    .getByRole("button", { name: "Scheduled delivery date", exact: true })
    .click();
  const calendar = page.getByRole("dialog", {
      name: "BS calendar",
      exact: true,
    }),
    bs = adToBs(date);
  await calendar
    .getByLabel("BS year", { exact: true })
    .selectOption(String(bs.year));
  await calendar
    .getByLabel("BS month", { exact: true })
    .selectOption(String(bs.month));
  await calendar
    .getByRole("button", { name: formatBusinessDate(date), exact: true })
    .click();
}
test("trip creation is first, future drafts preserve stock and filters retain current trips", async ({
  page,
  request,
}, info) => {
  const f = await activeFixtureTrip(request, 20, 2),
    original = await f.admin.workspace(f.trip),
    failures = errors(page);
  page.on("dialog", (d) => d.accept());
  const vehicle = randomUUID();
  await f.admin.rpc("save_vehicle", {
    p_id: vehicle,
    p_plate: "FUTURE-TRIP",
    p_description: "Tomorrow's van",
    p_active: true,
    p_version: 0,
    p_reason: "Future trip UI fixture",
    p_key: randomUUID(),
  });
  await login(page);
  await page.goto("/admin/trips");
  const section = page.getByTestId("create-trip-section"),
    current = page.getByTestId(`trip-card-${f.trip}`);
  expect((await section.boundingBox())!.y).toBeLessThan(
    (await current.boundingBox())!.y,
  );
  await expect(current).toContainText("Full jars loaded20");
  await expect(current).toContainText("Cartons loaded2");
  const tomorrow = shiftDate(
    original.days.find((d) => d.status === "OPEN")!.date_label,
    1,
  );
  await pick(page, tomorrow);
  await section
    .getByLabel("Driver", { exact: true })
    .selectOption("00000000-0000-0000-0000-000000000003");
  await section.getByLabel("Vehicle", { exact: true }).selectOption(vehicle);
  await section
    .getByLabel("Trip notes (optional)")
    .fill("Tomorrow morning deliveries");
  await page.getByRole("button", { name: "नेपाली", exact: true }).click();
  await expect(section.locator('input[name="notes"]')).toHaveValue(
    "Tomorrow morning deliveries",
  );
  await page.getByRole("button", { name: "English", exact: true }).click();
  await save(page, "Create draft trip", section);
  await expect(section.getByRole("status")).toContainText("Record saved.");
  const after = await f.admin.workspace();
  const draft = after.trips.find((t) => t.vehicle_id === vehicle)!;
  expect(draft.status).toBe("DRAFT");
  expect(draft.scheduled_date).toBe(tomorrow);
  expect(after.balances).toEqual(original.balances);
  await page.reload();
  await expect(page.getByTestId(`trip-card-${draft.id}`)).toContainText(
    "Draft",
  );
  await f.admin.rpc("load_trip", {
    p_trip: draft.id,
    p_items: [
      { product_id: fixtureIds.jar, stock_kind: "FULL_JAR", quantity: 15 },
    ],
    p_key: randomUUID(),
  });
  await page.reload();
  await expect(page.getByTestId(`trip-card-${draft.id}`)).toContainText(
    "Prepared / Loaded",
  );
  await expect(page.getByTestId(`trip-card-${draft.id}`)).toContainText(
    "Full jars loaded15",
  );
  await page.goto(
    `/admin/trips?from=${tomorrow}&to=${tomorrow}&driver=${draft.driver_id}&vehicle=${vehicle}&status=LOADED`,
  );
  await expect(
    page
      .getByRole("region", { name: "Trip history", exact: true })
      .getByTestId(`trip-card-${draft.id}`),
  ).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Active and prepared trips", exact: true })
      .getByTestId(`trip-card-${f.trip}`),
  ).toBeVisible();
  await layout(
    page,
    page.getByTestId("trips-workspace"),
    `test-results/admin-trips-${info.project.name}.png`,
  );
  expect(failures).toEqual([]);
});
test("customer and vehicle header dialogs preserve fields, filters, edits and assignments", async ({
  page,
  request,
}, info) => {
  const f = await activeFixtureTrip(request, 20),
    original = await f.admin.workspace(f.trip),
    failures = errors(page);
  page.on("dialog", (d) => d.accept());
  await login(page);
  await page.goto("/admin/customers");
  const add = page.getByRole("button", { name: "Add customer", exact: true });
  await add.click();
  let dialog = page.getByRole("dialog", { name: "Add customer", exact: true });
  for (let i = 0; i < 18; i++) {
    await page.keyboard.press("Tab");
    expect(
      await dialog.evaluate((el) => el.contains(document.activeElement)),
    ).toBe(true);
  }
  await page.keyboard.press("Shift+Tab");
  expect(
    await dialog.evaluate((el) => el.contains(document.activeElement)),
  ).toBe(true);
  await dialog
    .getByLabel("Customer name", { exact: true })
    .fill("Market HOUSE");
  await dialog
    .getByLabel("Customer Type", { exact: true })
    .selectOption("HOUSE");
  await dialog
    .getByLabel("Approval Status", { exact: true })
    .selectOption("APPROVED");
  await dialog.getByLabel("Phone", { exact: true }).fill("9800012345");
  await dialog.getByLabel("Address", { exact: true }).fill("Lakeside Pokhara");
  await dialog
    .getByLabel("Reason for this change", { exact: true })
    .fill("Approved market contact");
  await dialog.getByRole("button", { name: "नेपाली", exact: true }).click();
  dialog = page.locator("dialog[open]");
  await expect(dialog.locator('input[name="name"]')).toHaveValue(
    "Market HOUSE",
  );
  await expect(dialog.locator('select[name="supply_type"]')).toHaveValue(
    "HOUSE",
  );
  await layout(
    page,
    dialog,
    `test-results/customer-dialog-${info.project.name}-ne.png`,
  );
  await dialog.getByRole("button", { name: "English", exact: true }).click();
  await save(page, "Create customer", dialog);
  await expect(dialog.getByRole("status")).toContainText("Record saved.");
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(add).toBeFocused();
  const customer = (await f.admin.workspace()).customers.find(
    (c) => c.name === "Market HOUSE",
  )!;
  expect(customer.house_status).toBe("APPROVED");
  expect(customer.phone).toBe("9800012345");
  await page.getByLabel("Search customers").fill("Pokhara");
  await expect(page.getByTestId(`directory-card-${customer.id}`)).toBeVisible();
  await page.getByLabel("Customer Type", { exact: true }).selectOption("HOUSE");
  await page.getByLabel("Status", { exact: true }).selectOption("true");
  await page
    .getByTestId(`directory-card-${customer.id}`)
    .getByRole("link", { name: "View / edit", exact: true })
    .click();
  await page
    .getByLabel("Customer name", { exact: true })
    .fill("Market HOUSE updated");
  await page
    .getByLabel("Reason for this change", { exact: true })
    .first()
    .fill("Verified name correction");
  await save(page, "Save customer");
  await expect(
    page.getByText("Record saved.", { exact: true }).first(),
  ).toBeVisible();
  expect(
    (await f.admin.workspace()).customers.find((c) => c.id === customer.id)!
      .name,
  ).toBe("Market HOUSE updated");
  await page.goto("/admin/vehicles");
  await expect(page.getByTestId("vehicles-workspace")).toContainText(
    "Assigned driver",
  );
  await expect(page.getByText("Fixture driver", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Add vehicle", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Add vehicle", exact: true });
  await dialog.getByLabel("Number plate", { exact: true }).fill("UI-VEHICLE");
  await dialog
    .getByLabel("Description", { exact: true })
    .fill("Distribution van");
  await dialog
    .getByLabel("Reason for this change", { exact: true })
    .fill("Verified registration");
  await save(page, "Register vehicle", dialog);
  await expect(dialog.getByRole("status")).toContainText("Record saved.");
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  const newVehicle = (await f.admin.workspace()).vehicles.find(
    (v) => v.plate_number === "UI-VEHICLE",
  )!;
  await page
    .getByTestId(`directory-card-${newVehicle.id}`)
    .getByRole("link", { name: "View / edit", exact: true })
    .click();
  await page
    .getByLabel("Description", { exact: true })
    .fill("Verified distribution van");
  await page
    .getByLabel("Reason for this change", { exact: true })
    .fill("Description correction");
  await save(page, "Save vehicle");
  await expect(page.getByText("Record saved.", { exact: true })).toBeVisible();
  await page.goto(
    `/admin/vehicles/${original.trips.find((t) => t.id === f.trip)!.vehicle_id}`,
  );
  await expect(
    page.getByLabel("Status", { exact: true }).locator('option[value="false"]'),
  ).toBeDisabled();
  await page.goto("/admin/vehicles");
  await page.getByRole("button", { name: "Add vehicle", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Add vehicle", exact: true });
  await dialog.getByLabel("Number plate", { exact: true }).fill("ui-vehicle");
  await dialog
    .getByLabel("Reason for this change", { exact: true })
    .fill("Duplicate registration test");
  await save(page, "Register vehicle", dialog);
  await expect(dialog.getByRole("alert")).toContainText("already registered");
  await expect(dialog.getByLabel("Number plate", { exact: true })).toHaveValue(
    "ui-vehicle",
  );
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe(
    "hidden",
  );
  expect((await f.admin.workspace(f.trip)).balances).toEqual(original.balances);
  await layout(
    page,
    page.getByTestId("vehicles-workspace"),
    `test-results/admin-vehicles-${info.project.name}.png`,
  );
  await page.goto("/admin/customers");
  await layout(
    page,
    page.getByTestId("customers-workspace"),
    `test-results/admin-customers-${info.project.name}.png`,
  );
  expect(failures).toEqual([]);
});
test("driver details isolate sensitive actions, preserve accounts and show audit history", async ({
  page,
  request,
}, info) => {
  const f = await activeFixtureTrip(request, 20),
    original = await f.admin.workspace(f.trip),
    failures = errors(page);
  let approveConfirm = true;
  page.on("dialog", (d) => (approveConfirm ? d.accept() : d.dismiss()));
  await login(page);
  await page.goto("/admin/drivers");
  await expect(
    page.getByRole("button", { name: "Suspend Driver", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Authentication user ID", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByTestId(`driver-card-${fixtureIds.driver}`),
  ).toContainText("TEST-REFRESH");
  await layout(
    page,
    page.getByTestId("drivers-workspace"),
    `test-results/admin-drivers-${info.project.name}.png`,
  );
  await page.getByRole("button", { name: "नेपाली", exact: true }).click();
  await layout(
    page,
    page.getByTestId("drivers-workspace"),
    `test-results/admin-drivers-${info.project.name}-ne.png`,
  );
  await page.getByRole("button", { name: "English", exact: true }).click();
  await page.getByRole("button", { name: "Add driver", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add driver", exact: true });
  await dialog
    .getByLabel("Existing Supabase Auth user UUID", { exact: true })
    .fill("00000000-0000-0000-0000-000000000004");
  await dialog
    .getByLabel("Full name", { exact: true })
    .fill("Pending market driver");
  await dialog
    .getByLabel("Reason for this change", { exact: true })
    .fill("New account linkage");
  await layout(
    page,
    dialog,
    `test-results/driver-dialog-${info.project.name}.png`,
  );
  await save(page, "Create pending driver", dialog);
  await expect(dialog.getByRole("status")).toContainText("Record saved.");
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  const directory = await f.admin.rpc<DriverAccount[]>(
    "admin_driver_directory",
    {},
  );
  expect(directory.find((d) => d.id.endsWith("004"))!.approval_status).toBe(
    "PENDING",
  );
  await page.goto("/admin/drivers/00000000-0000-0000-0000-000000000004");
  await page
    .getByLabel("Reason for this change", { exact: true })
    .fill("Verified pending account approval");
  await save(page, "Approve Driver");
  await expect(
    page.getByRole("button", { name: "Suspend Driver", exact: true }),
  ).toBeVisible();
  expect(
    (await f.admin.rpc<DriverAccount[]>("admin_driver_directory", {})).find(
      (d) => d.id.endsWith("004"),
    )!.approval_status,
  ).toBe("APPROVED");
  await page.goto("/admin/drivers");
  await page.getByRole("button", { name: "Add driver", exact: true }).click();
  const duplicate = page.getByRole("dialog", {
    name: "Add driver",
    exact: true,
  });
  await duplicate
    .getByLabel("Existing Supabase Auth user UUID", { exact: true })
    .fill("00000000-0000-0000-0000-000000000003");
  await duplicate
    .getByLabel("Full name", { exact: true })
    .fill("Must not replace other driver");
  await duplicate
    .getByLabel("Reason for this change", { exact: true })
    .fill("Duplicate linkage test");
  await save(page, "Create pending driver", duplicate);
  await expect(duplicate.getByRole("alert")).toContainText("already exists");
  expect(
    (await f.admin.rpc<DriverAccount[]>("admin_driver_directory", {})).find(
      (d) => d.id.endsWith("003"),
    )!.name,
  ).toBe("Other driver");
  await duplicate.getByRole("button", { name: "Cancel", exact: true }).click();
  await page
    .getByTestId(`driver-card-${fixtureIds.driver}`)
    .getByRole("link", { name: "View Driver Details", exact: true })
    .click();
  await page
    .getByLabel("Reason for this change", { exact: true })
    .fill("Verified access review");
  approveConfirm = false;
  await page
    .getByRole("button", { name: "Suspend Driver", exact: true })
    .click();
  expect(
    (await f.admin.rpc<DriverAccount[]>("admin_driver_directory", {})).find(
      (d) => d.id === fixtureIds.driver,
    )!.approval_status,
  ).toBe("APPROVED");
  approveConfirm = true;
  await save(page, "Suspend Driver");
  await expect(
    page.getByRole("button", { name: "Reactivate Driver", exact: true }),
  ).toBeVisible();
  expect(
    (await f.admin.rpc<DriverAccount[]>("admin_driver_directory", {})).find(
      (d) => d.id === fixtureIds.driver,
    )!.approval_status,
  ).toBe("SUSPENDED");
  await page.reload();
  await expect(
    page.getByText("Driver access changed", { exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Reason for this change", { exact: true })
    .fill("Verified reactivation");
  await save(page, "Reactivate Driver");
  await expect(
    page.getByRole("button", { name: "Suspend Driver", exact: true }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Edit driver", exact: true }).click();
  const edit = page.getByRole("dialog", { name: "Edit driver", exact: true });
  await edit.getByLabel("Phone (optional)", { exact: true }).fill("9800098765");
  await edit
    .getByLabel("Reason for this change", { exact: true })
    .fill("Phone verified");
  await save(page, "Save driver", edit);
  await expect(edit.getByRole("status")).toContainText("Record saved.");
  await edit.getByRole("button", { name: "Close", exact: true }).click();
  const after = (
    await f.admin.rpc<DriverAccount[]>("admin_driver_directory", {})
  ).find((d) => d.id === fixtureIds.driver)!;
  expect(after.email).toBe("driver@fixture.example");
  expect(after.approval_status).toBe("APPROVED");
  expect(after.phone).toBe("9800098765");
  expect((await f.admin.workspace(f.trip)).balances).toEqual(original.balances);
  expect((await f.admin.workspace(f.trip)).trips).toEqual(original.trips);
  await layout(
    page,
    page.getByTestId("driver-details-workspace"),
    `test-results/driver-details-${info.project.name}.png`,
  );
  await openAdminMenuForSignOut(page);
  await page.getByRole("button", { name: "Sign Out", exact: true }).click();
  await expect(page).toHaveURL(/sign-in/);
  await login(page, "driver");
  expect(failures).toEqual([]);
});
