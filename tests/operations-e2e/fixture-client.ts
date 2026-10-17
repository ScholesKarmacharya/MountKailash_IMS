import { randomUUID } from "node:crypto";
import { expect, type APIRequestContext, type Page } from "@playwright/test";
export async function openAdminMenuForSignOut(page: Page) {
  // Driver sign-out now lives in More; admins retain the responsive drawer.
  const signOut = page.getByRole("button", { name: /^(Sign Out|लग आउट)$/ });
  const driverMenu = page.locator('header a[href="/driver/more"]');
  if (new URL(page.url()).pathname.startsWith("/driver/")) {
    await expect(driverMenu).toBeVisible();
    if (await signOut.isVisible()) return;
    await driverMenu.click();
    await expect(signOut).toBeVisible();
    return;
  }
  const trigger = page.getByTestId("admin-menu-button");
  if (
    new URL(page.url()).pathname.startsWith("/admin/") &&
    (page.viewportSize()?.width ?? 1280) < 1024
  )
    await expect(trigger).toBeVisible();
  if (
    (await trigger.isVisible()) &&
    !(await page.getByTestId("admin-mobile-drawer").isVisible())
  )
    await trigger.click();
}
import type { Workspace } from "../../src/domain/operations/types";
import type { Receipt, LocalState } from "../../src/domain/offline/types";

export async function saveDriverRecord(page: Page, label = "Save Delivery") {
  const button = page.getByRole("button", {
    name: label === "Collect outstanding credit" ? "Save collection" : label,
    exact: true,
  });
  const initialForm = button.locator("xpath=ancestor::form").first();
  const operation = await initialForm
    .locator('input[name="operation"]')
    .inputValue()
    .catch(() => "");
  const key = await initialForm.locator('input[name="key"]').inputValue();
  // The submit button is replaced after success, so anchor to the stable key.
  const form = page.locator("form").filter({
    has: page.locator(`input[name="key"][value="${key}"]`),
  });
  await button.click();
  // Acceptance is a durable local save. No server action is expected here;
  // each caller separately polls actual SQL rows and financial/stock effects.
  if (["driver-visit", "instant", "finance:PAYMENT"].includes(operation))
    await expect(
      form.getByRole("status").filter({ hasText: "Saved on phone" }),
    ).toBeVisible();
  else
    await expect(
      page.getByText("Saved on phone", { exact: true }).first(),
    ).toBeVisible();
}

/** Replay the actual retained driver envelope through the authorized gateway.
 * The automatic key and token stay inside the disposable browser profile. */
export async function replayDriverDelivery(
  page: Page,
  trip: string,
  id: string,
) {
  const receipt = await page.evaluate(
    async ({ trip, id }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const r = indexedDB.open("mount-kailash-offline");
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
      let row: {
          id: string;
          user: string;
          trip: string;
          retired?: boolean;
          salt: number[];
          iv: number[];
          cipher: number[];
        },
        secret: string;
      try {
        const rows = await new Promise<(typeof row)[]>((resolve, reject) => {
          const r = db.transaction("vaults").objectStore("vaults").getAll();
          r.onsuccess = () => resolve(r.result);
          r.onerror = () => reject(r.error);
        });
        const selected = rows.find((r) => r.trip === trip && !r.retired);
        if (!selected) throw new Error("Fixture journal unavailable");
        row = selected;
        const settings = await new Promise<{ value: string }>(
          (resolve, reject) => {
            const r = db
              .transaction("settings")
              .objectStore("settings")
              .get(`automatic-device:${row.user}`);
            r.onsuccess = () => resolve(r.result);
            r.onerror = () => reject(r.error);
          },
        );
        secret = (JSON.parse(settings.value) as { secret: string }).secret;
      } finally {
        db.close();
      }
      const material = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(secret),
        "PBKDF2",
        false,
        ["deriveKey"],
      );
      const key = await crypto.subtle.deriveKey(
        {
          name: "PBKDF2",
          salt: new Uint8Array(row.salt),
          iterations: 210000,
          hash: "SHA-256",
        },
        material,
        { name: "AES-GCM", length: 256 },
        false,
        ["decrypt"],
      );
      const bytes = await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: new Uint8Array(row.iv),
          additionalData: new TextEncoder().encode(row.id),
        },
        key,
        new Uint8Array(row.cipher),
      );
      const local = JSON.parse(new TextDecoder().decode(bytes)) as LocalState;
      const original = local.operations.find(
        (o) => o.kind === "DELIVERY" && o.id === id,
      );
      if (!original) throw new Error("Original fixture delivery unavailable");
      const { version, sequence, kind, occurredAt, payload, fingerprint } =
        original;
      const response = await fetch("/api/driver/offline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "post",
          trip,
          device: local.device,
          token: local.token,
          operation: {
            id,
            trip,
            version,
            sequence,
            kind,
            occurredAt,
            payload,
            fingerprint,
          },
        }),
      });
      if (!response.ok)
        throw new Error(`Fixture replay rejected: ${response.status}`);
      return (await response.json()) as Receipt;
    },
    { trip, id },
  );
  expect(receipt.status).toBe("CONFIRMED");
  expect(receipt.id).toBe(id);
  expect(receipt.trip).toBe(trip);
  return receipt.result;
}

// Fixed loopback fixture only. Never reads .env.local or contacts Supabase Cloud.
const provider =
  process.env.VERIFY_DRIVER_E2E === "1"
    ? "http://127.0.0.1:17779"
    : process.env.OFFLINE_E2E === "1"
      ? "http://127.0.0.1:17778"
      : "http://127.0.0.1:17777";
export const fixtureProvider = provider;
export const fixtureIds = {
  driver: "00000000-0000-0000-0000-000000000002",
  jar: "00000000-0000-0000-0000-000000000011",
};
export async function fixtureClient(
  request: APIRequestContext,
  role = "admin",
) {
  const login = await request.post(`${provider}/auth/v1/token`, {
    data: { email: `${role}@fixture.example`, password: "fixture-password" },
  });
  expect(login.ok()).toBe(true);
  const session = (await login.json()) as { access_token: string };
  async function rpc<T>(
    name: string,
    args: Record<string, unknown>,
  ): Promise<T> {
    const response = await request.post(`${provider}/rest/v1/rpc/${name}`, {
      headers: { authorization: `Bearer ${session.access_token}` },
      data: args,
    });
    expect(
      response.ok(),
      `${name}: ${response.status()} ${await response.text()}`,
    ).toBe(true);
    return (await response.json()) as T;
  }
  return {
    rpc,
    workspace: (trip: string | null = null) =>
      rpc<Workspace>("operations_workspace", { p_trip: trip }),
  };
}
export async function activeFixtureTrip(
  request: APIRequestContext,
  load = 100,
  cartons = 0,
  start = true,
) {
  // Schema initialization is fixture setup, not a UI/network responsiveness
  // assertion. Allow simultaneous isolated builds on slower Windows machines.
  expect(
    (await request.post(`${provider}/reset`, { timeout: 60000 })).ok(),
  ).toBe(true);
  const admin = await fixtureClient(request);
  const customer = randomUUID(),
    vehicle = randomUUID(),
    trip = randomUUID();
  await admin.rpc("save_customer", {
    p_id: customer,
    p_name: "Refresh customer",
    p_shop: "",
    p_phone: "",
    p_address: "",
    p_notes: "",
    p_active: true,
    p_version: 0,
    p_reason: "Isolated refresh test",
    p_key: randomUUID(),
  });
  await admin.rpc("save_vehicle", {
    p_id: vehicle,
    p_plate: "TEST-REFRESH",
    p_description: "",
    p_active: true,
    p_version: 0,
    p_reason: "Isolated refresh test",
    p_key: randomUUID(),
  });
  const day = (await admin.workspace()).days.find(
    (d) => d.status === "OPEN",
  )!.id;
  await admin.rpc("create_trip", {
    p_id: trip,
    p_driver: fixtureIds.driver,
    p_vehicle: vehicle,
    p_day: day,
    p_customers: [],
    p_notes: "",
    p_key: randomUUID(),
  });
  await admin.rpc("load_trip", {
    p_trip: trip,
    p_items: [
      ...(load
        ? [
            {
              product_id: fixtureIds.jar,
              stock_kind: "FULL_JAR",
              quantity: load,
            },
          ]
        : []),
      ...(cartons
        ? [
            {
              product_id: "00000000-0000-0000-0000-000000000012",
              stock_kind: "BOTTLE_CARTON",
              quantity: cartons,
            },
          ]
        : []),
    ],
    p_key: randomUUID(),
  });
  const driver = await fixtureClient(request, "driver");
  if (start)
    await driver.rpc("transition_trip", {
      p_trip: trip,
      p_action: "START",
      p_reason: "",
      p_key: randomUUID(),
    });
  return { admin, driver, customer, trip };
}
