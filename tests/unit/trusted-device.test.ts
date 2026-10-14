import "fake-indexeddb/auto";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { OfflineDatabase } from "@/lib/offline/store";
import {
  saveTrustedDevice,
  trustedDevice,
  unlockDevice,
  requireDeviceSignIn,
  validatePin,
  biometricsAvailable,
  enableBiometric,
  unlockBiometric,
} from "@/lib/offline/device";
let db: OfflineDatabase;
const user = crypto.randomUUID(),
  secrets = {
    device: crypto.randomUUID(),
    token: "a".repeat(64),
    secret: "b".repeat(64),
  },
  pin = "582947";
beforeEach(() => {
  db = new OfflineDatabase(`device-test-${crypto.randomUUID()}`);
});
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await db.delete();
});
it("encrypts optional biometric secrets using verified PRF output, never a stored raw wrapping key", async () => {
  await saveTrustedDevice(db, user, pin, secrets);
  const credential = new Uint8Array([1, 2, 3]),
    prf = new Uint8Array(32).fill(23),
    auth = new Uint8Array(33);
  auth[32] = 4;
  vi.stubGlobal("isSecureContext", true);
  vi.stubGlobal("PublicKeyCredential", {
    isUserVerifyingPlatformAuthenticatorAvailable: async () => true,
  });
  const get = vi.fn(async () => ({
    response: { authenticatorData: auth.buffer },
    getClientExtensionResults: () => ({
      prf: { results: { first: prf.buffer } },
    }),
  }));
  vi.stubGlobal("navigator", {
    credentials: {
      create: async () => ({
        rawId: credential.buffer,
        getClientExtensionResults: () => ({ prf: { enabled: true } }),
      }),
      get,
    },
  });
  await enableBiometric(db, user, secrets);
  expect(await unlockBiometric(db, user)).toEqual(secrets);
  expect(get).toHaveBeenCalledWith(
    expect.objectContaining({
      publicKey: expect.objectContaining({ userVerification: "required" }),
    }),
  );
  expect((await trustedDevice(db, user))?.biometric).not.toHaveProperty("key");
  await requireDeviceSignIn(db, user, true);
  await expect(unlockBiometric(db, user)).rejects.toThrow("Sign in online");
});
it("does not enroll biometrics when the platform ignores the encryption extension", async () => {
  await saveTrustedDevice(db, user, pin, secrets);
  vi.stubGlobal("isSecureContext", true);
  vi.stubGlobal("PublicKeyCredential", {
    isUserVerifyingPlatformAuthenticatorAvailable: async () => true,
  });
  vi.stubGlobal("navigator", {
    credentials: {
      create: async () => ({ getClientExtensionResults: () => ({}) }),
    },
  });
  await expect(enableBiometric(db, user, secrets)).rejects.toThrow(
    "unavailable",
  );
  expect((await trustedDevice(db, user))?.biometric).toBeUndefined();
});
it("wraps encryption/device secrets without a plaintext PIN and restores them after reopening", async () => {
  await saveTrustedDevice(db, user, pin, secrets);
  const stored = JSON.stringify(await db.settings.toArray());
  for (const secret of [pin, secrets.secret, secrets.token])
    expect(stored).not.toContain(secret);
  const name = db.name;
  db.close();
  db = new OfflineDatabase(name);
  expect(await unlockDevice(db, user, pin)).toEqual(secrets);
});
it("rejects a wrong PIN without changing encrypted business records", async () => {
  await saveTrustedDevice(db, user, pin, secrets);
  await db.settings.put({
    key: "pending-evidence",
    value: "immutable encrypted journal",
  });
  await expect(unlockDevice(db, user, "582946")).rejects.toThrow(
    "Incorrect PIN",
  );
  expect(await db.settings.get("pending-evidence")).toMatchObject({
    value: "immutable encrypted journal",
  });
  expect(await unlockDevice(db, user, pin)).toEqual(secrets);
});
it("persists throttling across restarts and increases delay after continued failures", async () => {
  await saveTrustedDevice(db, user, pin, secrets);
  for (let i = 0; i < 5; i++)
    await expect(unlockDevice(db, user, "bad")).rejects.toThrow(
      "Incorrect PIN",
    );
  const row = (await trustedDevice(db, user))!;
  expect(row.attempts).toBe(5);
  expect(row.retryAt).toBeGreaterThan(Date.now());
  const name = db.name;
  db.close();
  db = new OfflineDatabase(name);
  await expect(unlockDevice(db, user, pin)).rejects.toThrow(
    "Too many unlock attempts",
  );
  vi.spyOn(Date, "now").mockReturnValue(row.retryAt + 1);
  await expect(unlockDevice(db, user, "bad")).rejects.toThrow("Incorrect PIN");
  expect((await trustedDevice(db, user))!.retryAt).toBe(Date.now() + 60000);
});
it("serializes concurrent attempts so tabs cannot bypass the limit", async () => {
  await saveTrustedDevice(db, user, pin, secrets);
  const results = await Promise.allSettled(
    Array.from({ length: 8 }, () => unlockDevice(db, user, "bad")),
  );
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(0);
  expect((await trustedDevice(db, user))!.attempts).toBe(5);
});
it("sign-out requires online reauthentication and preserves encrypted keys", async () => {
  await saveTrustedDevice(db, user, pin, secrets);
  await requireDeviceSignIn(db, user, true);
  await expect(unlockDevice(db, user, pin)).rejects.toThrow(
    "Sign in online again",
  );
  await requireDeviceSignIn(db, user, false);
  expect(await unlockDevice(db, user, pin)).toEqual(secrets);
});
it("PIN recovery rewraps the same secret and invalidates the old PIN", async () => {
  await saveTrustedDevice(db, user, pin, secrets);
  await saveTrustedDevice(db, user, "748295", secrets);
  await expect(unlockDevice(db, user, pin)).rejects.toThrow("Incorrect PIN");
  expect(await unlockDevice(db, user, "748295")).toEqual(secrets);
});
it("does not silently replace another device's encrypted setup", async () => {
  await saveTrustedDevice(db, user, pin, secrets);
  await expect(
    saveTrustedDevice(db, user, pin, {
      ...secrets,
      device: crypto.randomUUID(),
    }),
  ).rejects.toThrow("Another device setup");
  expect(await unlockDevice(db, user, pin)).toEqual(secrets);
});
it("rejects short, nonnumeric, repeated and consecutive PINs", () => {
  for (const invalid of ["1234", "123456", "654321", "000000", "abc582947"])
    expect(() => validatePin(invalid)).toThrow();
  expect(() => validatePin(pin)).not.toThrow();
});
it("an unregistered device cannot unlock or assume biometric capability", async () => {
  await expect(unlockDevice(db, user, pin)).rejects.toThrow(
    "Activate this device online",
  );
  expect(await biometricsAvailable()).toBe(false);
});
