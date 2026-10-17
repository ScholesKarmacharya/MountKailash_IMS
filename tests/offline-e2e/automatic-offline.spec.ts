import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import {
  activeFixtureTrip,
  fixtureIds,
} from "../operations-e2e/fixture-client";
import type { FinanceWorkspace } from "../../src/domain/finance/types";

async function login(page: Page, role = "driver") {
  await page.goto("/sign-in?reauth=1");
  await page.getByRole("button", { name: "English", exact: true }).click();
  await page.getByLabel("Email address").fill(`${role}@fixture.example`);
  await page.getByLabel("Password", { exact: true }).fill("fixture-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(
    role === "admin" ? "**/admin/dashboard" : "**/driver/home",
  );
  await page.getByRole("button", { name: "English", exact: true }).click();
}
async function ready(page: Page) {
  await expect(page.getByText("Offline ready", { exact: true })).toBeVisible({
    timeout: 30000,
  });
  for (const label of ["Enter PIN", "Confirm PIN", "Offline passphrase"])
    await expect(page.getByLabel(label, { exact: true })).toHaveCount(0);
  for (const name of [
    "Unlock App",
    "Lock App",
    "Recover PIN online",
    "Set up offline access",
  ])
    await expect(page.getByRole("button", { name, exact: true })).toHaveCount(
      0,
    );
}
async function nav(page: Page, name: string) {
  await page
    .getByRole("navigation")
    .getByRole("link", { name, exact: true })
    .click();
}
async function deliver(
  page: Page,
  customer: string,
  quantity: number,
  method = "CASH",
) {
  await nav(page, "New Sale");
  const next = page.getByRole("button", {
    name: "Continue with updated data",
    exact: true,
  });
  if (await next.isVisible()) await next.click();
  await page.locator(`[data-customer-id="${customer}"]`).click();
  await page
    .getByLabel("Jars Delivered", { exact: true })
    .fill(String(quantity));
  await page.getByLabel("Empty Jars Returned", { exact: true }).fill("0");
  if (method === "CREDIT")
    await page.getByRole("button", { name: "Credit", exact: true }).click();
  else
    await page
      .getByLabel("Payment method", { exact: true })
      .selectOption(method);
  await page
    .getByRole("button", { name: "Review delivery", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Save Delivery", exact: true })
    .click();
  await expect(
    page.getByText("Saved on phone", { exact: true }).first(),
  ).toBeVisible({ timeout: 3000 });
}
async function stored(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open("mount-kailash-offline");
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    try {
      const tx = db.transaction("vaults");
      return await new Promise<
        { id: string; pending: number; cipher: number[] }[]
      >((resolve) => {
        const r = tx.objectStore("vaults").getAll();
        r.onsuccess = () => resolve(r.result);
      });
    } finally {
      db.close();
    }
  });
}
test.beforeEach(({ page }) => page.on("dialog", (d) => d.accept()));

test("automatically prepares, commits online before upload, reopens offline, and synchronizes a lost response once", async ({
  page,
  context,
  request,
}) => {
  const f = await activeFixtureTrip(request);
  await login(page);
  await ready(page);
  await page.route("**/api/driver/offline", async (route) => {
    if (route.request().postDataJSON()?.action === "post")
      await route.abort("internetdisconnected");
    else await route.continue();
  });
  await deliver(page, f.customer, 20);
  expect((await stored(page))[0]!.pending).toBe(1);
  expect((await f.admin.workspace(f.trip)).visits).toHaveLength(0);
  await context.setOffline(true);
  await page.reload();
  await ready(page);
  await page.getByRole("button", { name: "English", exact: true }).click();
  await nav(page, "My Stock");
  await expect(page.getByTestId("driver-remaining-full-jars")).toHaveText("80");
  await deliver(page, f.customer, 15, "FONEPAY");
  await nav(page, "My Stock");
  await expect(page.getByTestId("driver-remaining-full-jars")).toHaveText("65");
  await expect(page.getByTestId("pending-sync-count")).toHaveText(
    "2 changes saved on this phone",
  );
  await page.unroute("**/api/driver/offline");
  let committed = false;
  await page.route("**/api/driver/offline", async (route) => {
    if (!committed && route.request().postDataJSON()?.action === "post") {
      committed = true;
      await route.fetch();
      await context.setOffline(true);
      await route.abort("internetdisconnected");
    } else await route.continue();
  });
  await context.setOffline(false);
  await expect
    .poll(async () => (await f.admin.workspace(f.trip)).visits.length, {
      timeout: 30000,
    })
    .toBe(1);
  await page.reload();
  await ready(page);
  await page.unroute("**/api/driver/offline");
  await context.setOffline(false);
  await expect(page.getByText("All synced", { exact: true })).toBeVisible({
    timeout: 45000,
  });
  const w = await f.admin.workspace(f.trip);
  expect(w.visits).toHaveLength(2);
  const finance = await f.admin.rpc<FinanceWorkspace>("finance_workspace", {});
  expect(finance.payments).toHaveLength(2);
  expect(finance.payments.find((p) => p.method === "FONEPAY")?.status).toBe(
    "PENDING",
  );
  // Repeated online events also use the original receipt IDs.
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.getByText("All synced", { exact: true })).toBeVisible();
  expect((await f.admin.workspace(f.trip)).visits).toHaveLength(2);
});

test("cold local startup renders while the workspace probe is stalled", async ({
  page,
  request,
}) => {
  await activeFixtureTrip(request);
  await login(page);
  await ready(page);
  let release: (() => void) | undefined;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/driver/workspace**", async (route) => {
    await blocked;
    await route.abort();
  });
  try {
    await page.goto("/offline");
    await expect(page.getByTestId("driver-remaining-full-jars")).toHaveText(
      "100",
      { timeout: 5000 },
    );
    await ready(page);
  } finally {
    release!();
  }
});

test("admin warns before reset, preserves accepted and unsent history, and authorizes one replacement", async ({
  page,
  context,
  request,
  browser,
}) => {
  const f = await activeFixtureTrip(request);
  await login(page);
  await ready(page);
  await deliver(page, f.customer, 5);
  await expect(page.getByText("All synced", { exact: true })).toBeVisible({
    timeout: 30000,
  });
  await context.setOffline(true);
  await deliver(page, f.customer, 3, "CREDIT");
  const old = await stored(page);
  const adminContext = await browser.newContext({
    baseURL: new URL(page.url()).origin,
  });
  const replacementContext = await browser.newContext({
    baseURL: new URL(page.url()).origin,
  });
  try {
    const replacement = await replacementContext.newPage();
    replacement.on("dialog", (d) => d.accept());
    await login(replacement);
    await expect(
      replacement.getByText(
        "This trip is linked to another phone. Ask the warehouse admin to reset offline access.",
        { exact: true },
      ),
    ).toBeVisible();
    const admin = await adminContext.newPage();
    admin.on("dialog", (d) => d.accept());
    await login(admin, "admin");
    await admin.goto("/admin/drivers");
    await admin
      .getByTestId(`driver-card-${fixtureIds.driver}`)
      .getByRole("link", { name: "View Driver Details" })
      .click();
    const card = admin.getByTestId("driver-offline-access");
    await expect(card).toContainText("Fixture driver");
    await expect(card).toContainText("TEST-REFRESH");
    await expect(card).toContainText("Offline access active");
    await expect(card).not.toContainText("token");
    await expect(card).not.toContainText("vault");
    await expect(card).not.toContainText(f.trip);
    await card
      .getByRole("button", { name: "Reset Offline Access", exact: true })
      .click();
    const dialog = admin.getByRole("dialog", {
      name: "Reset offline access?",
      exact: true,
    });
    await expect(dialog).toContainText(
      "Reset offline access for Fixture driver?",
    );
    await expect(dialog).toContainText(
      "Previous sales, deliveries, offline records and audit history will be preserved.",
    );
    await expect(dialog.getByRole("alert")).toHaveText(
      "Changes that exist only on the old phone may not be recoverable after reset.",
    );
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    expect(
      (
        await f.admin.rpc<{ reset_pending: boolean }>(
          "admin_driver_offline_access",
          { p_driver: fixtureIds.driver },
        )
      ).reset_pending,
    ).toBe(false);
    await card
      .getByRole("button", { name: "Reset Offline Access", exact: true })
      .click();
    await dialog
      .getByLabel("Reason (optional)")
      .fill("Replacement approved after preserving the old phone");
    await dialog
      .getByRole("button", { name: "Reset Access", exact: true })
      .click();
    await expect(dialog.getByRole("status")).toHaveText(
      "Offline access reset successfully. The driver can reopen the app while online.",
    );
    await dialog
      .getByRole("button", { name: "Close dialog", exact: true })
      .last()
      .click();
    await expect(card).toContainText("Waiting for driver device");
    await expect(
      card.getByRole("button", { name: "Reset Offline Access", exact: true }),
    ).toBeEnabled();
    await expect(
      admin.getByText("Offline access reset", { exact: true }),
    ).toBeVisible();
    expect(
      (await f.admin.workspace(f.trip)).trips.find((t) => t.id === f.trip)
        ?.status,
    ).toBe("ACTIVE");
    await replacement.reload();
    await ready(replacement);
    await expect(
      replacement.getByTestId("driver-remaining-full-jars"),
    ).toHaveText("95");
    await deliver(replacement, f.customer, 2);
    await expect(
      replacement.getByText("All synced", { exact: true }),
    ).toBeVisible({ timeout: 30000 });
    expect((await f.admin.workspace(f.trip)).visits).toHaveLength(2);
    const history = await f.admin.rpc<{ reviews: { action: string }[] }>(
      "offline_admin_workspace",
      {},
    );
    expect(history.reviews.map((r) => r.action)).toEqual(
      expect.arrayContaining(["DEVICE_RESET", "DEVICE_TRANSFER"]),
    );
    expect((await stored(page))[0]!.pending).toBe(old[0]!.pending);
    expect((await stored(page))[0]!.cipher).toEqual(old[0]!.cipher);
    const denied = await replacement.request.post("/api/driver/offline", {
      headers: { Origin: new URL(replacement.url()).origin },
      data: {
        action: "register",
        trip: f.trip,
        device: randomUUID(),
        token: "f".repeat(64),
      },
    });
    expect(denied.status()).toBe(403);
  } finally {
    await adminContext.close();
    await replacementContext.close();
  }
});

test("admin driver offline card handles no registered device and no active trip safely", async ({
  page,
  request,
}) => {
  await activeFixtureTrip(request);
  await login(page, "admin");
  await page.goto(`/admin/drivers/${fixtureIds.driver}`);
  const card = page.getByTestId("driver-offline-access");
  await expect(card).toContainText("No device registered");
  await expect(card).toContainText("TEST-REFRESH");
  await expect(
    card.getByRole("button", { name: "Reset Offline Access", exact: true }),
  ).toBeDisabled();
  await page.goto("/admin/drivers/00000000-0000-0000-0000-000000000003");
  await expect(card).toContainText("Other driver");
  await expect(card).toContainText("No active trip");
  await expect(
    card.getByRole("button", { name: "Reset Offline Access", exact: true }),
  ).toBeDisabled();
});

test("driver cannot open admin offline access controls", async ({
  page,
  request,
}) => {
  await activeFixtureTrip(request);
  await login(page);
  await ready(page);
  await page.goto(`/admin/drivers/${fixtureIds.driver}`);
  await page.waitForURL("**/driver/home");
  await expect(page.getByTestId("driver-offline-access")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Reset Offline Access", exact: true }),
  ).toHaveCount(0);
});

test("an old setup with no delivery journal is preserved and replaced automatically without a PIN", async ({
  page,
  request,
}) => {
  const f = await activeFixtureTrip(request);
  const id = `${fixtureIds.driver}:${f.trip}`;
  const salt = crypto.getRandomValues(new Uint8Array(16)),
    iv = crypto.getRandomValues(new Uint8Array(12));
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode("old-fixture-passphrase"),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 210000, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"],
  );
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(id) },
    key,
    new TextEncoder().encode(
      JSON.stringify({ device: randomUUID(), token: "c".repeat(64) }),
    ),
  );
  const original = {
    id,
    user: fixtureIds.driver,
    trip: f.trip,
    salt: [...salt],
    iv: [...iv],
    cipher: [...new Uint8Array(cipher)],
    pending: 0,
    review: 0,
    updated: new Date().toISOString(),
  };
  await page.goto("/sign-in");
  await page.evaluate(async (row) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("mount-kailash-offline", 30);
      request.onupgradeneeded = () => {
        const db = request.result;
        for (const name of ["vaults", "preparations"]) {
          if (db.objectStoreNames.contains(name)) continue;
          const store = db.createObjectStore(name, { keyPath: "id" });
          store.createIndex("user", "user");
          store.createIndex("trip", "trip");
        }
        for (const name of ["settings", "leases"])
          if (!db.objectStoreNames.contains(name))
            db.createObjectStore(name, { keyPath: "key" });
        if (!db.objectStoreNames.contains("archives"))
          db.createObjectStore("archives", { keyPath: "id" }).createIndex(
            "kind",
            "kind",
          );
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction("preparations", "readwrite");
        tx.objectStore("preparations").put(row);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  }, original);
  await login(page);
  await ready(page);
  await expect(
    page.getByText(
      "Saved records on this phone need help from the admin. Keep this app's data.",
      { exact: true },
    ),
  ).toHaveCount(0);
  expect(await localEntries(page, "archives")).toContainEqual(
    expect.objectContaining({ kind: "SETUP", row: original }),
  );
  expect((await stored(page))[0]!.pending).toBe(0);
  await nav(page, "New Sale");
  await expect(page.getByLabel("Visit notes", { exact: true })).toHaveCount(0);
  await deliver(page, f.customer, 2);
});

async function localEntries(page: Page, store: string) {
  return page.evaluate(async (name) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open("mount-kailash-offline");
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    try {
      return await new Promise<unknown[]>((resolve, reject) => {
        const r = db.transaction(name).objectStore(name).getAll();
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
    } finally {
      db.close();
    }
  }, store);
}

async function loseAutomaticKey(page: Page) {
  await page.evaluate(async (user) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open("mount-kailash-offline");
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction("settings", "readwrite");
        tx.objectStore("settings").delete(`automatic-device:${user}`);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  }, fixtureIds.driver);
}

test("a zero-pending unreadable copy waits for admin reset, preserves history and draft, then rebuilds automatically", async ({
  page,
  context,
  request,
  browser,
}) => {
  const f = await activeFixtureTrip(request);
  await login(page);
  await ready(page);
  await deliver(page, f.customer, 5);
  await expect(page.getByText("All synced", { exact: true })).toBeVisible({
    timeout: 30000,
  });
  const accepted = (await f.admin.workspace(f.trip)).visits[0]!;
  await context.setOffline(true);
  await loseAutomaticKey(page);
  const original = (await stored(page))[0]!;
  await page.reload();
  await page.getByRole("button", { name: "English", exact: true }).click();
  await context.setOffline(false);
  const linked =
    "This trip is linked to another phone. Ask the warehouse admin to reset offline access.";
  await expect(page.getByText(linked, { exact: true })).toBeVisible({
    timeout: 30000,
  });
  await expect(
    page.getByText(
      "Saved records on this phone need help from the admin. Keep this app's data.",
      { exact: true },
    ),
  ).toHaveCount(0);
  expect((await stored(page))[0]).toEqual(original);
  await nav(page, "New Sale");
  await page.locator(`[data-customer-id="${f.customer}"]`).click();
  await page.getByLabel("Jars Delivered", { exact: true }).fill("2");
  await page
    .getByLabel("Payment method", { exact: true })
    .selectOption("FONEPAY");
  await page
    .getByLabel("Total Amount Received (NPR)", { exact: true })
    .fill("300.50");
  await expect(page.getByLabel("Visit notes", { exact: true })).toHaveCount(0);
  await page
    .getByRole("button", { name: "Review delivery", exact: true })
    .click();
  const form = page.locator("form").filter({
    has: page.locator('input[name="operation"][value="driver-visit"]'),
  });
  await form.evaluate((form) => {
    form.dataset.originalDraft = "yes";
  });
  const key = await form.locator('input[name="key"]').inputValue();
  await expect(
    form.getByRole("button", { name: "Save Delivery", exact: true }),
  ).toBeDisabled();
  const adminContext = await browser.newContext({
    baseURL: new URL(page.url()).origin,
  });
  try {
    const admin = await adminContext.newPage();
    admin.on("dialog", (d) => d.accept());
    await login(admin, "admin");
    await admin.goto("/admin/sync");
    await admin
      .getByText("Reset Offline Device", { exact: true })
      .first()
      .click();
    const reset = admin.locator("form").filter({
      has: admin.locator(
        'input[name="operation"][value="offline:reset-device"]',
      ),
    });
    await reset
      .getByLabel("Reason and evidence")
      .fill("Explicit admin replacement after preserving local history");
    await reset
      .getByRole("button", { name: "Reset Offline Device", exact: true })
      .click();
    await expect(
      admin.getByText(
        "Offline access has been reset. Ask the replacement driver to tap Retry.",
        { exact: true },
      ),
    ).toBeVisible();
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await ready(page);
    await expect(form).toHaveAttribute("data-original-draft", "yes");
    await expect(form.locator('input[name="key"]')).toHaveValue(key);
    await expect(form.locator('input[name="customer"]')).toHaveValue(
      f.customer,
    );
    await expect(form.locator('input[name="payment_status"]')).toHaveValue(
      "FONEPAY",
    );
    await expect(form.locator('input[name="received_amount"]')).toHaveValue(
      "300.50",
    );
    await expect(form.locator('input[name="notes"]')).toHaveValue("");
    expect(await localEntries(page, "archives")).toContainEqual(
      expect.objectContaining({ kind: "RECORDS", row: original }),
    );
    await form
      .getByRole("button", { name: "Save Delivery", exact: true })
      .click();
    await expect(form.getByText("Saved on phone", { exact: true })).toBeVisible(
      { timeout: 3000 },
    );
    await expect(page.getByText("All synced", { exact: true })).toBeVisible({
      timeout: 30000,
    });
    const visits = (await f.admin.workspace(f.trip)).visits;
    expect(visits).toHaveLength(2);
    expect(visits.find((visit) => visit.id === accepted.id)).toEqual(accepted);
    expect(visits.every((visit) => visit.notes === "")).toBe(true);
  } finally {
    await adminContext.close();
  }
});

test("unreadable pending records are kept on the phone and are never replaced by automatic preparation", async ({
  page,
  context,
  request,
}) => {
  const f = await activeFixtureTrip(request);
  await login(page);
  await ready(page);
  await context.setOffline(true);
  await deliver(page, f.customer, 3, "CREDIT");
  await loseAutomaticKey(page);
  const original = (await stored(page))[0]!;
  expect(original.pending).toBe(1);
  await page.reload();
  await page.getByRole("button", { name: "English", exact: true }).click();
  await context.setOffline(false);
  await expect(
    page.getByText(
      "Saved records on this phone need help from the admin. Keep this app's data.",
      { exact: true },
    ),
  ).toBeVisible({ timeout: 30000 });
  expect((await stored(page))[0]).toEqual(original);
  expect(await localEntries(page, "archives")).toHaveLength(0);
  expect((await f.admin.workspace(f.trip)).visits).toHaveLength(0);
});
