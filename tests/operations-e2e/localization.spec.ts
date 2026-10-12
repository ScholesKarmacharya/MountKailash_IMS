import { test, expect, type Page } from "@playwright/test";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { activeFixtureTrip, fixtureClient } from "./fixture-client";
import type { FinanceWorkspace } from "../../src/domain/finance/types";
import { message } from "../../src/lib/i18n/messages";
import {
  formatBusinessDate,
  bsMonthRange,
  presetRange,
} from "../../src/domain/localization/calendar";
async function login(page: Page, role = "driver") {
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "English", exact: true }).click();
  await page.getByLabel("Email address").fill(`${role}@fixture.example`);
  await page.getByLabel("Password", { exact: true }).fill("fixture-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(
    role === "admin" ? /admin\/dashboard/ : /driver\/home/,
  );
  const title = role === "admin" ? "Operations dashboard" : "My day";
  await expect(
    page.getByRole("heading", {
      name: new RegExp(`^(${title}|${message("ne", title)})$`),
    }),
  ).toBeVisible();
}
async function language(page: Page, locale: "en" | "ne") {
  const button = page.getByRole("button", {
    name: locale === "en" ? "English" : "नेपाली",
    exact: true,
  });
  const saved = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/preferences") && r.request().method() === "POST",
  );
  await button.click();
  expect((await saved).status()).toBe(200);
  await expect(button).toBeEnabled();
  await expect(button).toHaveAttribute("aria-pressed", "true");
}
test("Nepali driver delivery preserves drafts during language switches and downloads a Nepali PDF", async ({
  page,
  request,
}) => {
  const fixture = await activeFixtureTrip(request);
  let confirmation = "";
  page.on("dialog", (d) => {
    confirmation = d.message();
    return d.accept();
  });
  await login(page);
  await expect(
    page.getByRole("heading", { name: "मेरो दिन", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "नयाँ डेलिभरी", exact: true })
    .first()
    .click();
  await page
    .getByRole("button", { name: "Refresh customer", exact: true })
    .click();
  await page.getByLabel("डेलिभरी भएका जार", { exact: true }).fill("35");
  await page.getByLabel("फिर्ता आएका खाली जार", { exact: true }).fill("30");
  await page
    .getByLabel("प्राप्त भएको जम्मा रकम (NPR)", { exact: true })
    .fill("५२५८.७५");
  const url = page.url();
  await language(page, "en");
  expect(page.url()).toBe(url);
  await expect(page.getByLabel("Jars Delivered", { exact: true })).toHaveValue(
    "35",
  );
  await expect(
    page.getByLabel("Empty Jars Returned", { exact: true }),
  ).toHaveValue("30");
  await language(page, "ne");
  await expect(
    page.getByLabel("डेलिभरी भएका जार", { exact: true }),
  ).toHaveValue("35");
  await expect(
    page.getByLabel("फिर्ता आएका खाली जार", { exact: true }),
  ).toHaveValue("30");
  await page
    .getByRole("button", { name: "डेलिभरी समीक्षा", exact: true })
    .click();
  await page.getByRole("button", { name: "डेलिभरी बचत", exact: true }).click();
  await expect(
    page.getByText("अभिलेख बचत भयो।", { exact: true }),
  ).toBeVisible();
  expect(confirmation).toContain("३५");
  expect(confirmation).toContain("Refresh customer");
  expect(confirmation).not.toContain(" full,");
  const finance = await fixture.driver.rpc<FinanceWorkspace>(
    "finance_workspace",
    {},
  );
  expect(finance.invoices).toHaveLength(1);
  expect(finance.invoices[0]!.total).toBe("5258.75");
  const pending = (
    await fixture.driver.rpc<{
      rows: { pending: number; original_date: string }[];
    }>("pending_jar_directory", { p_customer: null })
  ).rows;
  expect(pending.reduce((n, r) => n + r.pending, 0)).toBe(5);
  await page.goto(`/driver/invoices/${finance.invoices[0]!.id}`);
  await expect(
    page
      .getByText(formatBusinessDate(finance.invoices[0]!.date_label, "ne"), {
        exact: false,
      })
      .first(),
  ).toBeVisible();
  await expect(
    page.getByText("ग्राहक: Refresh customer", { exact: true }),
  ).toBeVisible();
  const download = await page.request.get(
    `/api/invoices/${finance.invoices[0]!.id}/pdf`,
  );
  expect(download.ok()).toBe(true);
  const loadingTask = getDocument({
    data: new Uint8Array(await download.body()),
    useSystemFonts: false,
  });
  const pdfDocument = await loadingTask.promise;
  const lines = [];
  for (let i = 1; i <= pdfDocument.numPages; i++)
    lines.push(
      (await (await pdfDocument.getPage(i)).getTextContent()).items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" "),
    );
  // PDF glyph shaping can insert extraction spaces inside conjuncts.
  expect(lines.join(" ").replaceAll(/\s/g, "")).toContain("ग्राहक:");
  expect(lines.join(" ")).toContain("५,२५८.७५");
  await loadingTask.destroy();
  await page.goto("/driver/pending-jars");
  await expect(page.locator("#pending-jars")).toContainText(
    "५ फिर्ता आउन बाँकी जार",
  );
  await expect(page.locator("#pending-jars")).toContainText(
    formatBusinessDate(pending[0]!.original_date, "ne"),
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.goto("/driver/return");
  await page
    .getByRole("button", {
      name: message("ne", "Submit warehouse returns"),
      exact: true,
    })
    .click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: message("ne", "Saved to the database.") }),
  ).toBeVisible();
  expect((await fixture.driver.workspace(fixture.trip)).trips[0]!.status).toBe(
    "SUBMITTED",
  );
  await page
    .getByRole("button", { name: message("ne", "Sign Out"), exact: true })
    .click();
  await expect(page).toHaveURL(/sign-in/);
  await login(page, "admin");
  await language(page, "ne");
  await page.goto(`/admin/trips/${fixture.trip}`);
  await page
    .getByLabel(message("ne", "Verification / discrepancy reason"), {
      exact: true,
    })
    .fill("भौतिक फिर्ता जार जाँच");
  await page
    .getByRole("button", {
      name: message("ne", "Post physical verification"),
      exact: true,
    })
    .click();
  await expect
    .poll(
      async () =>
        (await fixture.admin.workspace(fixture.trip)).trips[0]!.status,
    )
    .toBe("CLOSED");
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: message("ne", "Saved to the database.") }),
  ).toBeVisible();
  const closed = await fixture.admin.workspace(fixture.trip);
  expect(closed.trips[0]!.status).toBe("CLOSED");
  expect(
    closed.movements
      .filter(
        (m) => m.movement_type === "TRIP_RETURN" && m.stock_kind === "FULL_JAR",
      )
      .reduce((n, m) => n + m.quantity, 0),
  ).toBe(65);
  expect(
    closed.movements
      .filter(
        (m) =>
          m.movement_type === "TRIP_RETURN" && m.stock_kind === "EMPTY_JAR",
      )
      .reduce((n, m) => n + m.quantity, 0),
  ).toBe(30);
});
test("independent user preferences persist through navigation, refresh and login; BS filters and authorization remain real", async ({
  page,
  request,
  browser,
}) => {
  await activeFixtureTrip(request);
  await login(page, "admin");
  await expect(
    page.getByRole("heading", { name: "Operations dashboard", exact: true }),
  ).toBeVisible();
  await language(page, "ne");
  await page.goto("/admin/reports");
  await expect(
    page.getByRole("heading", { name: "दैनिक इतिहास", exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("मिति अवधि", { exact: true })
    .first()
    .selectOption("month");
  await page
    .getByRole("button", { name: "इतिहास छान्नुहोस्", exact: true })
    .click();
  const expected = presetRange("month");
  // Query arguments are canonical dates, independent of the displayed locale.
  const q = new URL(page.url()).searchParams;
  expect(q.get("from")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(q.get("from")).not.toBe("2083-06-01");
  expect(q.get("from")).toBe(expected.from);
  expect(q.get("to")).toBe(expected.to);
  await page
    .getByRole("button", { name: "देखि मिति", exact: true })
    .first()
    .click();
  const calendar = page.getByRole("dialog", { name: "विक्रम संवत् पात्रो" });
  await expect(calendar).toBeVisible();
  await calendar
    .getByLabel("वि.सं. वर्ष", { exact: true })
    .selectOption("2083");
  await calendar.getByLabel("वि.सं. महिना", { exact: true }).selectOption("6");
  await calendar
    .getByRole("button", { name: "२६ असोज २०८३", exact: true })
    .click();
  await expect(page.locator('input[name="from"]').first()).toHaveValue(
    "2026-10-12",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "दैनिक इतिहास", exact: true }),
  ).toBeVisible();
  const other = await browser.newContext({ viewport: page.viewportSize()! });
  try {
    const driverPage = await other.newPage();
    await login(driverPage);
    await expect(
      driverPage.getByRole("heading", { name: "मेरो दिन", exact: true }),
    ).toBeVisible();
    await language(driverPage, "en");
    await driverPage.goto("/admin/inventory");
    await expect(driverPage).toHaveURL(/driver\/home/);
    await expect(
      driverPage.getByRole("heading", { name: "My day", exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "दैनिक इतिहास", exact: true }),
    ).toBeVisible();
    const client = await fixtureClient(request, "admin");
    const before = await client.workspace();
    const bad = await driverPage.request.post("/api/preferences", {
      data: { locale: "ADMIN" },
      headers: { origin: new URL(driverPage.url()).origin },
    });
    expect(bad.status()).toBe(400);
    expect((await client.workspace()).balances).toEqual(before.balances);
    await driverPage
      .getByRole("button", { name: "Sign Out", exact: true })
      .click();
    await expect(driverPage).toHaveURL(/\/sign-in/);
    await login(driverPage);
    await expect(
      driverPage.getByRole("heading", { name: "My day", exact: true }),
    ).toBeVisible();
  } finally {
    await other.close();
  }
  await language(page, "en");
  await page.goto("/admin/credit");
  await expect(
    page.getByRole("heading", { name: "BS credit statement", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Statement year", { exact: true }).selectOption("2083");
  await page.getByLabel("Statement month", { exact: true }).selectOption("6");
  const range = bsMonthRange(2083, 6),
    customer = (await (await fixtureClient(request)).workspace()).customers[0]!
      .id;
  const csv = await page.request.get(
    `/api/customer-statements/${customer}?from=${range.from}&to=${range.to}&format=csv`,
  );
  expect(csv.ok()).toBe(true);
  expect(await csv.text()).toContain("CanonicalTimestamp");
});
