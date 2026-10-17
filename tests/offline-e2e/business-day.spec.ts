import {
  driverNavigate,
  driverReturn,
  activeScreen,
} from "./driver-navigation";
import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import {
  activeFixtureTrip,
  fixtureIds,
} from "../operations-e2e/fixture-client";
import type { FinanceWorkspace } from "../../src/domain/finance/types";
import type { DayDetail } from "../../src/domain/business-days/types";
import { cents } from "../../src/domain/finance/money";
import { formatBusinessDate } from "../../src/domain/localization/calendar";
import { message } from "../../src/lib/i18n/messages";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

test("a workspace response started before a confirmed return cannot leave the driver in ACTIVE status", async ({
  page,
  request,
}) => {
  page.on("dialog", (d) => d.accept());
  const f = await activeFixtureTrip(request);
  await login(page);
  await language(page, "en");
  await nav(page, "Return to Warehouse");
  await expect(
    page.getByRole("button", {
      name: "Review Return",
      exact: true,
    }),
  ).toBeEnabled();
  let captured = false,
    holding = false,
    release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/driver/workspace?*", async (route) => {
    if (!holding) {
      holding = true;
      const stale = await route.fetch();
      expect(stale.ok()).toBe(true);
      expect((await stale.json()).trip.status).toBe("ACTIVE");
      captured = true;
      await held;
      await route.fulfill({ response: stale });
    } else await route.continue();
  });
  try {
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect.poll(() => captured).toBe(true);
    await driverReturn(page);
    await expect(
      page.getByText("Saved on phone", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Return submitted. Waiting for warehouse confirmation.", {
        exact: true,
      }),
    ).toBeVisible();
    const returned = page.waitForResponse((r) =>
      r.url().includes("/api/driver/workspace?"),
    );
    release();
    await returned;
    await expect(
      page.getByText("Return submitted. Waiting for warehouse confirmation.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect
      .poll(async () => (await f.admin.workspace(f.trip)).trips[0]?.status)
      .toBe("SUBMITTED");
  } finally {
    release();
  }
});
async function language(page: Page, locale: "en" | "ne") {
  const button = page.getByRole("button", {
    name: locale === "en" ? "English" : "नेपाली",
    exact: true,
  });
  await button.click();
  await expect(button).toBeEnabled();
  await expect(button).toHaveAttribute("aria-pressed", "true");
}
async function login(page: Page, role = "driver") {
  await page.goto("/sign-in");
  await page.getByLabel("Email address").fill(`${role}@fixture.example`);
  await page.getByLabel("Password", { exact: true }).fill("fixture-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(
    role === "admin" ? "**/admin/dashboard" : "**/driver/home",
  );
}
async function nav(page: Page, label: string) {
  await driverNavigate(page, label);
}
async function unlock(page: Page) {
  await language(page, "en");

  await expect(page.getByTestId("driver-remaining-full-jars")).toHaveText("65");
}
const saleForm = (page: Page) =>
  page
    .locator("#add-delivery")
    .locator("form")
    .filter({
      has: page.locator('input[name="operation"][value="driver-visit"]'),
    });
async function deliver(
  page: Page,
  customer: string,
  jars: number,
  empties: number,
  paid: boolean,
) {
  await nav(page, "New Sale");
  await page.locator(`[data-customer-id="${customer}"]`).click();
  const form = saleForm(page);
  await form.getByLabel("Jars Delivered", { exact: true }).fill(String(jars));
  await form
    .getByLabel("Empty Jars Returned", { exact: true })
    .fill(String(empties));
  if (paid)
    await form
      .getByLabel("Total Amount Received (NPR)", { exact: true })
      .fill((jars * 150.25).toFixed(2));
  else await form.getByRole("button", { name: "Credit", exact: true }).click();
  // Language changes preserve the actual draft, rather than reconstructing it.
  await language(page, "ne");
  await expect(
    form.getByLabel(message("ne", "Jars Delivered"), { exact: true }),
  ).toHaveValue(String(jars));
  await expect(
    form.getByLabel(message("ne", "Empty Jars Returned"), { exact: true }),
  ).toHaveValue(String(empties));
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await language(page, "en");
  await form
    .getByRole("button", { name: "Review delivery", exact: true })
    .click();
  await form
    .getByRole("button", { name: "Save Delivery", exact: true })
    .click();
}
async function saveAdmin(page: Page, label: string) {
  const action = page.waitForResponse(
    (r) =>
      r.request().method() === "POST" && !!r.request().headers()["next-action"],
  );
  await page.getByRole("button", { name: label, exact: true }).click();
  expect((await action).ok()).toBe(true);
}
async function deviceMetadata(page: Page) {
  return page.evaluate(async () => {
    const request = indexedDB.open("mount-kailash-offline");
    return new Promise<{ pending: number; cipher: number[]; id: string }[]>(
      (resolve, reject) => {
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result,
            rows = db.transaction("vaults").objectStore("vaults").getAll();
          rows.onerror = () => {
            db.close();
            reject(rows.error);
          };
          rows.onsuccess = () => {
            db.close();
            resolve(rows.result);
          };
        };
      },
    );
  });
}

test("complete isolated business day: 100 loaded, two customers, 35 sold/25 empties, interrupted sync, credit collection, returns, refill, reload and immutable closing", async ({
  page,
  context,
  request,
  browser,
}) => {
  test.setTimeout(240000);
  page.on("dialog", (d) => d.accept());
  const f = await activeFixtureTrip(request),
    second = randomUUID();
  await f.admin.rpc("save_customer", {
    p_id: second,
    p_name: "Second customer",
    p_shop: "",
    p_phone: "",
    p_address: "",
    p_notes: "",
    p_active: true,
    p_version: 0,
    p_reason: "Isolated final verification",
    p_key: randomUUID(),
  });
  const trip = (await f.admin.workspace(f.trip)).trips[0]!,
    day = trip.business_day_id;
  const detail = (id = day) =>
    f.admin.rpc<DayDetail>("business_day_report", { p_day: id });
  const finance = () => f.admin.rpc<FinanceWorkspace>("finance_workspace", {});
  await login(page);
  await expect(
    page.getByRole("button", { name: "नेपाली", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await language(page, "en");
  await expect(page.getByTestId("driver-remaining-full-jars")).toHaveText(
    "100",
  );
  await expect(page.getByRole("main")).toContainText(trip.plate_number);
  await nav(page, "New Sale");
  await expect(page.getByLabel("Offline passphrase")).toHaveCount(0);
  await expect(page.getByText("Offline ready", { exact: true })).toBeVisible({
    timeout: 30000,
  });

  await expect(page.getByText("All synced", { exact: true })).toBeVisible({
    timeout: 30000,
  });
  await deliver(page, f.customer, 20, 15, true);
  await expect(
    saleForm(page).getByText("Saved on phone", { exact: true }),
  ).toBeVisible();
  await nav(page, "My Stock");
  await expect(page.getByTestId("driver-remaining-full-jars")).toHaveText("80");
  await expect
    .poll(async () => (await f.admin.workspace(f.trip)).visits.length)
    .toBe(1);
  const online = await f.admin.workspace(f.trip);
  expect(online.visits).toHaveLength(1);
  expect(
    online.custody.find((c) => c.customer_id === f.customer)?.quantity,
  ).toBe(5);

  const adminContext = await browser.newContext({
    baseURL: new URL(page.url()).origin,
    viewport: page.viewportSize()!,
  });
  try {
    const admin = await adminContext.newPage();
    admin.on("dialog", (d) => d.accept());
    await login(admin, "admin");
    await expect(
      admin.getByRole("button", { name: "English", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await admin.goto(`/admin/trips/${f.trip}`);
    await expect(admin.getByTestId("driver-remaining-full-jars")).toHaveText(
      "80",
    );
    await expect(admin.getByTestId("driver-full-jars-sold")).toHaveText("20");

    await context.setOffline(true);
    await expect(
      page
        .getByTestId("driver-sync-status")
        .getByText("Offline", { exact: true }),
    ).toBeVisible();
    await deliver(page, second, 15, 10, false);
    await expect(
      saleForm(page).getByText("Saved on phone", { exact: true }),
    ).toBeVisible();
    await nav(page, "Customers");
    await page
      .getByRole("button", { name: "Add Customer", exact: true })
      .click();
    await page
      .getByLabel("Customer name", { exact: true })
      .fill("Created while offline");
    await page
      .getByRole("button", { name: "Save and select customer", exact: true })
      .click();
    await expect(page.getByTestId("pending-sync-count")).toHaveText(
      /Saved on phone|2 changes/,
    );
    const stored = await deviceMetadata(page);
    expect(stored[0]?.pending).toBe(2);
    expect(stored[0]?.cipher.length).toBeGreaterThan(100);
    expect(JSON.stringify(stored)).not.toContain("Created while offline");
    await nav(page, "My Stock");
    await expect(page.getByTestId("driver-remaining-full-jars")).toHaveText(
      "65",
    );
    await expect(page.getByTestId("driver-empty-jars-collected")).toHaveText(
      "25",
    );
    await nav(page, "Unreturned Jars");
    for (const name of ["Refresh customer", "Second customer"])
      await expect(
        page
          .getByTestId("driver-jar-card")
          .filter({ has: page.getByRole("heading", { name, exact: true }) }),
      ).toContainText("5");
    await nav(page, "Sales History");
    await page.getByText("Filter", { exact: true }).click();
    await activeScreen(page)
      .getByLabel("Date range", { exact: true })
      .selectOption("today");
    await page
      .getByRole("button", { name: "Filter history", exact: true })
      .click();
    await expect(page).toHaveURL(/\/driver\/sales\?from=.*&to=/);
    await expect(page.getByLabel("Offline passphrase")).toHaveCount(0);
    await expect(
      page.getByText("Saved on phone", { exact: true }).first(),
    ).toBeVisible();
    await nav(page, "Return to Warehouse");
    await expect(
      page.getByRole("button", {
        name: "Review Return",
        exact: true,
      }),
    ).toBeVisible();
    await nav(page, "My Stock");
    await page.reload();
    await expect(page).toHaveURL(/\/driver\/home$/);
    await unlock(page);
    await expect(page.getByTestId("pending-sync-count")).toHaveText(
      /Saved on phone|2 changes/,
    );
    await nav(page, "New Sale");
    const createdId = await page
      .getByRole("button", { name: "Created while offline", exact: true })
      .getAttribute("data-customer-id");
    expect(createdId).toBeTruthy();
    await nav(page, "My Stock");

    // Commit the offline sale, then lose its response and disconnect before the
    // contact uploads. Reopening must reconcile its original receipt first.
    let interrupted = false;
    const uploads: { id: string; kind: string }[] = [];
    page.on("request", (r) => {
      if (r.url().endsWith("/api/driver/offline") && r.method() === "POST") {
        const body = r.postDataJSON();
        if (body?.action === "post")
          uploads.push({ id: body.operation.id, kind: body.operation.kind });
      }
    });
    await page.route("**/api/driver/offline", async (route) => {
      const body = route.request().postDataJSON();
      if (
        body?.action === "post" &&
        body.operation.kind === "DELIVERY" &&
        !interrupted
      ) {
        interrupted = true;
        const response = await route.fetch();
        expect(response.ok()).toBe(true);
        await context.setOffline(true);
        await route.abort("internetdisconnected");
      } else await route.continue();
    });
    await context.setOffline(false);
    await expect.poll(() => interrupted, { timeout: 30000 }).toBe(true);
    await expect(
      page
        .getByTestId("driver-sync-status")
        .getByText("Offline", { exact: true }),
    ).toBeVisible();
    expect((await f.admin.workspace(f.trip)).visits).toHaveLength(2);
    await page.reload();
    await unlock(page);
    await expect(page.getByTestId("pending-sync-count")).toHaveText(
      /Saved on phone|2 changes/,
    );
    await context.setOffline(false);
    await expect(page.getByText("All synced", { exact: true })).toBeVisible({
      timeout: 45000,
    });
    await expect(page.getByTestId("pending-sync-count")).toHaveText(
      "All synced",
    );
    expect(uploads.filter((o) => o.kind === "DELIVERY")).toHaveLength(1);
    expect(new Set(uploads.map((o) => o.id)).size).toBe(2);
    const confirmed = await f.admin.workspace(f.trip);
    expect(confirmed.visits).toHaveLength(2);
    expect(confirmed.items.reduce((n, i) => n + i.full_jars, 0)).toBe(35);
    expect(confirmed.items.reduce((n, i) => n + i.empty_jars, 0)).toBe(25);
    for (const customer of [f.customer, second])
      expect(
        confirmed.custody.find((c) => c.customer_id === customer)?.quantity,
      ).toBe(5);
    expect(
      confirmed.customers.find((c) => c.name === "Created while offline")?.id,
    ).toBe(createdId);
    const after = await finance();
    expect(after.invoices).toHaveLength(2);
    expect(after.payments).toHaveLength(1);
    expect(
      after.credit.find((c) => c.customer_id === second)?.outstanding,
    ).toBe("2253.75");
    await admin.reload();
    for (const [metric, value] of [
      ["driver-full-jars-sold", "35"],
      ["driver-remaining-full-jars", "65"],
      ["driver-empty-jars-collected", "25"],
    ])
      await expect(admin.getByTestId(metric!)).toHaveText(value!);
    await page.reload();
    await unlock(page);
    await nav(page, "New Sale");
    await page.locator(`[data-customer-id="${createdId}"]`).click();
    await expect(
      saleForm(page).getByText("Selected: Created while offline", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(saleForm(page).getByRole("alert")).toHaveCount(0);

    // Collect already confirmed credit separately, without another sale.
    await nav(page, "Collections");
    await page
      .getByLabel("Collection customer", { exact: true })
      .selectOption(second);
    await page
      .getByLabel("Credit amount received (NPR)", { exact: true })
      .fill("50");
    await page
      .getByRole("button", { name: "Save collection", exact: true })
      .click();
    await expect(
      page.getByLabel("Credit amount received (NPR)", { exact: true }),
    ).toHaveValue("");
    await expect(page.getByText("All synced", { exact: true })).toBeVisible({
      timeout: 30000,
    });
    await expect
      .poll(
        async () =>
          (await finance()).credit.find((c) => c.customer_id === second)
            ?.outstanding,
      )
      .toBe("2203.75");
    expect((await finance()).invoices).toHaveLength(2);
    expect((await finance()).deposits).toHaveLength(0);
    await nav(page, "Return to Warehouse");
    await driverReturn(page);
    await expect
      .poll(async () => (await f.admin.workspace(f.trip)).trips[0]?.status)
      .toBe("SUBMITTED");
    await expect(page.getByText("All synced", { exact: true })).toBeVisible({
      timeout: 30000,
    });
    await f.admin.rpc("reconcile_trip", {
      p_trip: f.trip,
      p_counts: [
        { product_id: fixtureIds.jar, stock_kind: "FULL_JAR", quantity: 65 },
        { product_id: fixtureIds.jar, stock_kind: "EMPTY_JAR", quantity: 25 },
      ],
      p_reason: "Isolated physically verified returns",
      p_accept_variance: false,
      p_key: randomUUID(),
    });
    await f.admin.rpc("process_warehouse_jars", {
      p_day: day,
      p_product: fixtureIds.jar,
      p_operation: "REFILL",
      p_kind: "EMPTY_JAR",
      p_quantity: 25,
      p_reason: "Isolated inspected refill",
      p_key: randomUUID(),
    });
    const reload = randomUUID();
    await f.admin.rpc("create_trip", {
      p_id: reload,
      p_driver: fixtureIds.driver,
      p_vehicle: trip.vehicle_id,
      p_day: day,
      p_customers: [],
      p_notes: "Second isolated round",
      p_key: randomUUID(),
    });
    await f.admin.rpc("load_trip", {
      p_trip: reload,
      p_items: [
        { product_id: fixtureIds.jar, stock_kind: "FULL_JAR", quantity: 20 },
      ],
      p_key: randomUUID(),
    });
    await nav(page, "My Stock");
    await expect(page.getByTestId("driver-remaining-full-jars")).toHaveText(
      "20",
      { timeout: 30000 },
    );
    await page.getByRole("button", { name: "Start Trip", exact: true }).click();
    await expect
      .poll(async () => (await f.admin.workspace(reload)).trips[0]?.status)
      .toBe("ACTIVE");
    await expect(
      page.getByRole("button", { name: "Start Trip", exact: true }),
    ).toHaveCount(0);
    await nav(page, "Return to Warehouse");
    await driverReturn(page);
    await expect
      .poll(async () => (await f.admin.workspace(reload)).trips[0]?.status)
      .toBe("SUBMITTED");
    await f.admin.rpc("reconcile_trip", {
      p_trip: reload,
      p_counts: [
        { product_id: fixtureIds.jar, stock_kind: "FULL_JAR", quantity: 20 },
        { product_id: fixtureIds.jar, stock_kind: "EMPTY_JAR", quantity: 0 },
      ],
      p_reason: "Second isolated physical return",
      p_accept_variance: false,
      p_key: randomUUID(),
    });
    await admin.goto("/admin/daily-close");
    expect((await detail()).blockers).toHaveLength(0);
    await saveAdmin(admin, "Begin closing review");
    await admin
      .getByLabel("Net cash handed over (NPR)", { exact: true })
      .fill("3055.00");
    await admin
      .getByLabel("Reconciliation evidence / closing notes", { exact: true })
      .fill("Final isolated stock, cash, credit and custody verification");
    for (const checkbox of await admin.getByRole("checkbox").all())
      await checkbox.check();
    await saveAdmin(admin, "Confirm and close business day");
    await expect
      .poll(async () => (await detail()).report.source)
      .toBe("ARCHIVED");
    const archived = (await detail()).report;
    expect(archived.totals.full_jars).toBe(35);
    expect(archived.totals.empty_jars).toBe(25);
    expect(cents(archived.totals.sales)).toBe(cents("5258.75"));
    expect(cents(archived.totals.cash_net)).toBe(cents("3055.00"));
    expect(archived.custody.filter((c) => c.quantity === 5)).toHaveLength(2);
    expect(
      archived.credit.find((c) => c.customer_id === second)?.outstanding,
    ).toBe("2203.75");
    await language(admin, "ne");
    const pdf = await admin.request.get(`/api/business-days/${day}/pdf`);
    expect(pdf.ok()).toBe(true);
    const loading = getDocument({
      data: new Uint8Array(await pdf.body()),
      useSystemFonts: false,
    });
    try {
      const document = await loading.promise,
        lines: string[] = [];
      for (let i = 1; i <= document.numPages; i++)
        lines.push(
          (await (await document.getPage(i)).getTextContent()).items
            .map((x) => ("str" in x ? x.str : ""))
            .join(" "),
        );
      const text = lines.join(" ").replace(/\s/g, "");
      expect(text).toContain(
        formatBusinessDate(archived.day.date_label, "ne").replace(/\s/g, ""),
      );
      expect(text).toContain("Secondcustomer");
      expect(text).toContain("५,२५८.७५");
    } finally {
      await loading.destroy();
    }
    await language(admin, "en");
    await saveAdmin(admin, "Open business day");
    const next = (await f.admin.workspace()).days.find(
      (d) => d.status === "OPEN",
    )!;
    expect(next.id).not.toBe(day);
    const carried = (await detail(next.id)).report;
    expect(
      carried.stock.find(
        (s) =>
          s.product_id === fixtureIds.jar &&
          s.stock_kind === "FULL_JAR" &&
          s.location_kind === "WAREHOUSE",
      )?.opening,
    ).toBe(90);
    expect(
      carried.credit.find((c) => c.customer_id === second)?.outstanding,
    ).toBe("2203.75");
    expect(carried.custody.filter((c) => c.quantity === 5)).toHaveLength(2);
    expect((await detail()).report).toEqual(archived);
    await admin.goto(`/admin/reports/${day}`);
    await admin.reload();
    await expect(admin.getByText(/Immutable closing archive/)).toBeVisible();
    expect((await detail()).report).toEqual(archived);
  } finally {
    await context.setOffline(false);
    await adminContext.close();
  }
});
