import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { activeFixtureTrip, fixtureIds } from "./fixture-client";
import { customerErrorMessages } from "../../src/domain/operations/customer-errors";
import ne from "../../src/lib/i18n/ne.json";
async function login(page: Page) {
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "English", exact: true }).click();
  await page.getByLabel("Email address").fill("driver@fixture.example");
  await page.getByLabel("Password", { exact: true }).fill("fixture-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/driver/home");
  await page.getByRole("button", { name: "English", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "English", exact: true }),
  ).toBeEnabled();
}
const saleForm = (page: Page) =>
  page.locator("form").filter({
    has: page.locator('input[name="operation"][value="driver-visit"]'),
  });
test("regular/HOUSE lookup, rapid reselection and retries preserve the delivery draft", async ({
  page,
  request,
}) => {
  const f = await activeFixtureTrip(request, 100, 10),
    house = randomUUID();
  await f.admin.rpc("save_house_customer", {
    p_id: house,
    p_name: "Lookup House",
    p_shop: "",
    p_phone: "",
    p_address: "",
    p_notes: "",
    p_active: true,
    p_version: 0,
    p_reason: "Approved browser fixture",
    p_key: randomUUID(),
    p_contact_person: "",
    p_supply_type: "HOUSE",
    p_house_status: "APPROVED",
  });
  await login(page);
  const loaded = page.waitForResponse((r) =>
    r.url().includes(`/customers/${f.customer}/context`),
  );
  await page.goto(`/driver/delivery?customer=${f.customer}`);
  expect((await loaded).status()).toBe(200);
  const form = saleForm(page);
  await form.getByLabel("Jars Delivered", { exact: true }).fill("2");
  await form.getByLabel("Empty Jars Returned", { exact: true }).fill("1");
  await form
    .getByLabel("Total Amount Received (NPR)", { exact: true })
    .fill("300.50");
  await form.getByLabel("Visit notes", { exact: true }).fill("Keep this draft");
  await expect(
    form.getByRole("button", { name: "Review delivery", exact: true }),
  ).toBeEnabled();
  await form
    .getByRole("button", { name: "Lookup House", exact: false })
    .click();
  await expect(
    form.getByText("No Payment Required", { exact: true }),
  ).toBeVisible();
  // Delay the old selection to prove it cannot replace the newer HOUSE context.
  await page.route(
    `**/api/driver/customers/${f.customer}/context?*`,
    async (route) => {
      const response = await route.fetch();
      await new Promise((resolve) => setTimeout(resolve, 500));
      await route.fulfill({ response }).catch(() => {});
    },
  );
  const regularStarted = page.waitForRequest((r) =>
    r.url().includes(`/customers/${f.customer}/context`),
  );
  await form
    .getByRole("button", { name: "Refresh customer", exact: false })
    .click();
  await regularStarted;
  await form
    .getByRole("button", { name: "Lookup House", exact: false })
    .click();
  await expect(
    form.getByText("No Payment Required", { exact: true }),
  ).toBeVisible();
  await page.unroute(`**/api/driver/customers/${f.customer}/context?*`);
  await expect(form.getByLabel("Jars Delivered", { exact: true })).toHaveValue(
    "2",
  );
  await expect(
    form.getByLabel("Empty Jars Returned", { exact: true }),
  ).toHaveValue("1");
  await expect(form.getByLabel("Visit notes", { exact: true })).toHaveValue(
    "Keep this draft",
  );
  await form
    .getByRole("button", { name: "Refresh customer", exact: false })
    .click();
  await expect(
    form.getByText("No Payment Required", { exact: true }),
  ).toHaveCount(0);
  await expect(
    form.getByLabel("Total Amount Received (NPR)", { exact: true }),
  ).toHaveValue("300.50");
  for (const [status, code] of [
    [503, "SCHEMA"],
    [403, "AUTHORIZATION"],
    [404, "NOT_FOUND"],
    [401, "AUTHENTICATION"],
    [409, "CONFLICT"],
    [503, "TEMPORARY"],
  ] as const) {
    await page.route("**/api/driver/customers/*/context?*", (route) =>
      route.fulfill({ status, json: { code } }),
    );
    await form
      .getByRole("button", { name: "Lookup House", exact: false })
      .click();
    await expect(
      form.getByRole("alert").filter({ hasText: customerErrorMessages[code] }),
    ).toBeVisible();
    await expect(
      form.getByRole("button", { name: "Review delivery", exact: true }),
    ).toBeDisabled();
    await expect(
      form.getByText("No Payment Required", { exact: true }),
    ).toHaveCount(0);
    await expect(form.getByLabel("Visit notes", { exact: true })).toHaveValue(
      "Keep this draft",
    );
    await page.getByRole("button", { name: "नेपाली", exact: true }).click();
    await expect(
      form.getByRole("alert").filter({
        hasText: ne[customerErrorMessages[code] as keyof typeof ne],
      }),
    ).toBeVisible();
    await page.getByRole("button", { name: "English", exact: true }).click();
    await page.unroute("**/api/driver/customers/*/context?*");
    await form
      .getByRole("button", { name: "Retry customer lookup", exact: true })
      .click();
    await expect(
      form.getByText("No Payment Required", { exact: true }),
    ).toBeVisible();
    await form
      .getByRole("button", { name: "Refresh customer", exact: false })
      .click();
    await expect(
      form.getByRole("button", { name: "Review delivery", exact: true }),
    ).toBeEnabled();
  }
  await page.route("**/api/driver/customers/*/context?*", (route) =>
    route.abort("internetdisconnected"),
  );
  await form
    .getByRole("button", { name: "Lookup House", exact: false })
    .click();
  await expect(
    form.getByRole("alert").filter({ hasText: customerErrorMessages.NETWORK }),
  ).toBeVisible();
  await expect(
    form.getByRole("button", { name: "Review delivery", exact: true }),
  ).toBeDisabled();
});
test("expired access token refreshes for customer API; an expired refresh token gives 401 and preserves the draft", async ({
  page,
  context,
  request,
}) => {
  const f = await activeFixtureTrip(request);
  await login(page);
  const loaded = page.waitForResponse((r) =>
    r.url().includes(`/customers/${f.customer}/context`),
  );
  await page.goto(`/driver/delivery?customer=${f.customer}`);
  expect((await loaded).status()).toBe(200);
  const form = saleForm(page);
  await form.getByLabel("Jars Delivered", { exact: true }).fill("3");
  await form
    .getByLabel("Visit notes", { exact: true })
    .fill("Expired session draft");
  const cookies = await context.cookies(),
    auth = cookies.find((c) => c.name.includes("auth-token"))!;
  expect(auth).toBeDefined();
  const stored = JSON.parse(
    Buffer.from(auth.value.replace(/^base64-/, ""), "base64url").toString(),
  );
  const expire = async (refresh: string) => {
    const session = {
      ...stored,
      refresh_token: refresh,
      expires_at: 1,
      expires_in: 0,
    };
    const parts = session.access_token.split(".");
    const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString());
    parts[1] = Buffer.from(JSON.stringify({ ...claims, exp: 1 })).toString(
      "base64url",
    );
    session.access_token = parts.join(".");
    await context.addCookies([
      {
        ...auth,
        value: `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`,
      },
    ]);
  };
  await expire(`fixture-${fixtureIds.driver}`);
  const refreshed = await page.request.get(
    `/api/driver/customers/${f.customer}/context?trip=${f.trip}`,
  );
  expect(refreshed.status()).toBe(200);
  expect(refreshed.headers()["set-cookie"]).toContain("auth-token");
  const updated = (await context.cookies()).find((c) => c.name === auth.name)!;
  expect(updated.value).not.toBe(auth.value);
  await expire("invalid-fixture-refresh");
  // Click the selected customer again to invoke the API while keeping this page.
  await form
    .getByRole("button", { name: "Refresh customer", exact: false })
    .click();
  await expect(
    form
      .getByRole("alert")
      .filter({ hasText: customerErrorMessages.AUTHENTICATION }),
  ).toBeVisible();
  await expect(form.getByLabel("Jars Delivered", { exact: true })).toHaveValue(
    "3",
  );
  await expect(form.getByLabel("Visit notes", { exact: true })).toHaveValue(
    "Expired session draft",
  );
  await expect(
    form.getByRole("button", { name: "Review delivery", exact: true }),
  ).toBeDisabled();
});
