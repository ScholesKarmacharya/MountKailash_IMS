import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { canonical } from "../../src/domain/offline/operations";
import {
  activeFixtureTrip,
  fixtureClient,
  fixtureIds,
  saveDriverRecord,
} from "../operations-e2e/fixture-client";
import { driverNavigate } from "./driver-navigation";
import type { DriverOfflineAccess } from "../../src/domain/offline/admin";

async function login(page: Page, role = "driver") {
  page.on("dialog", (dialog) => dialog.accept());
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
async function resetViaCard(page: Page) {
  const card = page.getByTestId("driver-offline-access");
  await card
    .getByRole("button", { name: "Reset Offline Access", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Reset offline access?",
    exact: true,
  });
  await dialog
    .getByLabel("Reason (optional)")
    .fill("UAT ownership recovery in isolated database");
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
  await expect(card).toContainText("Previous device");
  await expect(card).toContainText("Revoked");
  await expect(card).toContainText("Last reset");
}
async function ready(page: Page) {
  await expect(page.getByText("Offline ready", { exact: true })).toBeVisible({
    timeout: 45000,
  });
}

test("revoked browser with NO trip round can be reset from admin and refresh into offline ready without losing saved setup", async ({
  page,
  request,
  browser,
}) => {
  const f = await activeFixtureTrip(request, 10, 0, false);
  const driver = await fixtureClient(request, "driver");
  const old = randomUUID(),
    token = "a".repeat(64);
  await driver.rpc("trusted_device_register", {
    p_device: old,
    p_token: token,
    p_name: "Revoked UAT browser",
    p_recovery: "automatic-key-stored-only-on-device",
  });
  await f.admin.rpc("trusted_device_revoke", {
    p_device: old,
    p_reason: "UAT previously revoked",
  });
  await page.goto("/sign-in");
  await page.evaluate(
    async ({ user, device, token }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const r = indexedDB.open("mount-kailash-offline", 3);
        r.onupgradeneeded = () => {
          for (const name of ["vaults", "preparations"]) {
            const s = r.result.createObjectStore(name, { keyPath: "id" });
            s.createIndex("user", "user");
            s.createIndex("trip", "trip");
          }
          r.result.createObjectStore("settings", { keyPath: "key" });
          r.result.createObjectStore("leases", { keyPath: "key" });
          const archives = r.result.createObjectStore("archives", {
            keyPath: "id",
          });
          archives.createIndex("kind", "kind");
        };
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction("settings", "readwrite");
          tx.objectStore("settings").put({
            key: `automatic-device:${user}`,
            value: JSON.stringify({
              device,
              token,
              secret: "b".repeat(64),
              requiresSignIn: false,
            }),
          });
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
      } finally {
        db.close();
      }
    },
    { user: fixtureIds.driver, device: old, token },
  );
  await login(page);
  await expect(
    page
      .getByText(
        "This browser's offline access was revoked. Ask the warehouse admin to reset offline access.",
        { exact: true },
      )
      .first(),
  ).toBeVisible();
  const adminContext = await browser.newContext({
    baseURL: new URL(page.url()).origin,
  });
  try {
    const admin = await adminContext.newPage();
    await login(admin, "admin");
    await admin.goto(`/admin/drivers/${fixtureIds.driver}`);
    await expect(admin.getByTestId("driver-offline-access")).toContainText(
      "Device reset required",
    );
    await expect(
      admin.getByText(
        "There is no registered device or current offline access to reset.",
        { exact: true },
      ),
    ).toHaveCount(0);
    await resetViaCard(admin);
    await page.reload();
    await ready(page);
    await expect(page.getByTestId("driver-remaining-full-jars")).toHaveText(
      "10",
    );
    const local = await page.evaluate(async (user) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const r = indexedDB.open("mount-kailash-offline");
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
      const read = (name: string, key?: string) =>
        new Promise<unknown>((resolve, reject) => {
          const store = db.transaction(name).objectStore(name);
          const r = key ? store.get(key) : store.getAll();
          r.onsuccess = () => resolve(r.result);
          r.onerror = () => reject(r.error);
        });
      try {
        const setting = (await read(
          "settings",
          `automatic-device:${user}`,
        )) as { value: string };
        return {
          device: JSON.parse(setting.value).device,
          retired: !!(await read(
            "settings",
            `retired-automatic-device:${user}:${JSON.parse(((await read("settings")) as { key: string; value: string }[]).find((s) => s.key.startsWith(`retired-automatic-device:${user}:`))!.value).device}`,
          )),
          archives: ((await read("archives")) as unknown[]).length,
        };
      } finally {
        db.close();
      }
    }, fixtureIds.driver);
    expect(local.device).not.toBe(old);
    expect(local.retired).toBe(true);
    expect(local.archives).toBeGreaterThanOrEqual(1);
    const devices = await f.admin.rpc<
      { device_id: string; revoked_at: string | null }[]
    >("trusted_device_directory", {});
    expect(devices.find((d) => d.device_id === old)?.revoked_at).toBeTruthy();
    expect(
      devices.find((d) => d.device_id === local.device)?.revoked_at,
    ).toBeNull();
    await admin.reload();
    await expect(admin.getByTestId("driver-offline-access")).toContainText(
      "Offline access active",
    );
  } finally {
    await adminContext.close();
  }
});

test("bound owner A remains fenced while admin resets and B prepares the same trip and posts once", async ({
  page,
  request,
  browser,
}) => {
  const f = await activeFixtureTrip(request, 10);
  await login(page);
  await ready(page);
  const origin = new URL(page.url()).origin;
  const adminContext = await browser.newContext({ baseURL: origin });
  const bContext = await browser.newContext({ baseURL: origin });
  try {
    const b = await bContext.newPage();
    await login(b);
    await expect(
      b
        .getByText(
          "This trip is linked to another phone. Ask the warehouse admin to reset offline access.",
          { exact: true },
        )
        .first(),
    ).toBeVisible();
    const admin = await adminContext.newPage();
    await login(admin, "admin");
    await admin.goto(`/admin/drivers/${fixtureIds.driver}`);
    await resetViaCard(admin);
    const waiting = await f.admin.rpc<DriverOfflineAccess>(
      "admin_driver_offline_access",
      { p_driver: fixtureIds.driver },
    );
    await f.admin.rpc("offline_admin_reset_access", {
      p_driver: fixtureIds.driver,
      p_trip: f.trip,
      p_reason: "Repeated pending reset",
      p_key: randomUUID(),
    });
    expect(
      (
        await f.admin.rpc<DriverOfflineAccess>("admin_driver_offline_access", {
          p_driver: fixtureIds.driver,
        })
      ).last_reset_at,
    ).toBe(waiting.last_reset_at);
    await b.reload();
    await ready(b);
    // Read and use the old credential only inside its disposable browser. Return
    // HTTP status, never registration material, to the test runner.
    const denied = await page.evaluate(
      async ({ user, trip, payload }) => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const r = indexedDB.open("mount-kailash-offline");
          r.onsuccess = () => resolve(r.result);
          r.onerror = () => reject(r.error);
        });
        let c: { device: string; token: string };
        try {
          const row = await new Promise<{ value: string }>(
            (resolve, reject) => {
              const r = db
                .transaction("settings")
                .objectStore("settings")
                .get(`automatic-device:${user}`);
              r.onsuccess = () => resolve(r.result);
              r.onerror = () => reject(r.error);
            },
          );
          c = JSON.parse(row.value);
        } finally {
          db.close();
        }
        const check = await fetch("/api/driver/offline", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "checkin",
            trip,
            device: c.device,
            token: c.token,
            pending: 0,
          }),
        });

        const hash = Array.from(
          new Uint8Array(
            await crypto.subtle.digest(
              "SHA-256",
              new TextEncoder().encode(payload),
            ),
          ),
          (b) => b.toString(16).padStart(2, "0"),
        ).join("");
        const post = await fetch("/api/driver/offline", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "post",
            trip,
            device: c.device,
            token: c.token,
            operation: {
              version: 1,
              id: crypto.randomUUID(),
              trip,
              sequence: 1,
              kind: "DELIVERY",
              occurredAt: new Date().toISOString(),
              payload,
              fingerprint: hash,
            },
          }),
        });
        return { checkin: check.status, post: post.status };
      },
      {
        user: fixtureIds.driver,
        trip: f.trip,
        payload: canonical({
          customer: f.customer,
          walk_name: "",
          walk_phone: "",
          items: [
            {
              product_id: fixtureIds.jar,
              full_jars: 1,
              empty_jars: 0,
              cartons: 0,
            },
          ],
          status: "PAID",
          received: "150.25",
          total: "150.25",
          notes: "",
          prices: [{ product_id: fixtureIds.jar, price: "150.25" }],
          custody: [{ product_id: fixtureIds.jar, quantity: 0 }],
        }),
      },
    );
    expect(denied).toEqual({ checkin: 403, post: 403 });
    await driverNavigate(b, "New Sale");
    await b.locator(`[data-customer-id="${f.customer}"]`).click();
    await b.getByLabel("Jars Delivered", { exact: true }).fill("2");
    await b
      .getByRole("button", { name: "Review delivery", exact: true })
      .click();
    await saveDriverRecord(b);
    await expect
      .poll(async () => (await f.admin.workspace(f.trip)).visits.length, {
        timeout: 45000,
      })
      .toBe(1);
    await b.reload();
    await ready(b);
    await driverNavigate(b, "My Stock");
    await expect(b.getByTestId("driver-remaining-full-jars")).toHaveText("8");
    const history = await f.admin.rpc<{
      reviews: { action: string }[];
      rounds: { trip_id: string }[];
    }>("offline_admin_workspace", {});
    expect(history.reviews.map((r) => r.action)).toEqual(
      expect.arrayContaining(["DEVICE_RESET", "DEVICE_TRANSFER"]),
    );
    expect(history.rounds.filter((r) => r.trip_id === f.trip)).toHaveLength(1);
  } finally {
    await adminContext.close();
    await bContext.close();
  }
});
