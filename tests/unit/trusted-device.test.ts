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
  createAutomaticDeviceSecrets,
  getAutomaticDeviceSecrets,
  clearAutomaticDeviceSecrets,
  replaceRevokedAutomaticDevice,
} from "@/lib/offline/device";
let db: OfflineDatabase;
const user = crypto.randomUUID(),
  secrets = {
    device: crypto.randomUUID(),
    token: "a".repeat(64),
    secret: "b".repeat(64),
  },
  pin = "5829";
beforeEach(() => {
  db = new OfflineDatabase(`device-test-${crypto.randomUUID()}`);
});
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await db.delete();
});
it("automatically generates one random installation secret across tabs and restores it after restart", async () => {
  const [first, second] = await Promise.all([
    createAutomaticDeviceSecrets(db, user),
    createAutomaticDeviceSecrets(db, user),
  ]);
  expect(first).toEqual(second);
  expect(first.secret).toMatch(/^[a-f0-9]{64}$/);
  expect(first.token).toMatch(/^[a-f0-9]{64}$/);
  expect(first.secret).not.toBe(first.token);
  expect(
    (await createAutomaticDeviceSecrets(db, crypto.randomUUID())).secret,
  ).not.toBe(first.secret);
  const name = db.name;
  db.close();
  db = new OfflineDatabase(name);
  expect(await getAutomaticDeviceSecrets(db, user)).toEqual(first);
  await requireDeviceSignIn(db, user, true);
  await expect(getAutomaticDeviceSecrets(db, user)).rejects.toThrow(
    "Sign in online",
  );
  await requireDeviceSignIn(db, user, false);
  expect(await getAutomaticDeviceSecrets(db, user)).toEqual(first);
});
it("never removes the automatic key while a preparation or encrypted journal exists", async () => {
  await createAutomaticDeviceSecrets(db, user);
  const evidence = {
    id: `${user}:trip`,
    user,
    trip: "trip",
    salt: [],
    iv: [],
    cipher: [1, 2],
    pending: 1,
    review: 0,
    updated: "",
  };
  await db.vaults.add(evidence);
  await expect(clearAutomaticDeviceSecrets(db, user)).rejects.toThrow(
    "Keep this phone's saved data",
  );
  expect(await db.vaults.get(evidence.id)).toEqual(evidence);
  expect(await getAutomaticDeviceSecrets(db, user)).toBeDefined();
});
it("durably rotates only registration credentials after server authorization, preserving the key, archived setup and historical journals", async () => {
  const original = await createAutomaticDeviceSecrets(db, user);
  const row = {
    id: `${user}:current`,
    user,
    trip: "current",
    salt: [1],
    iv: [2],
    cipher: [3],
    pending: 0,
    review: 0,
    updated: "",
  };
  const history = {
    ...row,
    id: `${user}:history`,
    trip: "history",
    pending: 2,
  };
  await db.preparations.add(row);
  await db.vaults.add(history);
  const next = await replaceRevokedAutomaticDevice(
    db,
    user,
    "current",
    original.device,
  );
  expect(next.device).not.toBe(original.device);
  expect(next.token).not.toBe(original.token);
  expect(next.secret).toBe(original.secret);
  expect(await getAutomaticDeviceSecrets(db, user)).toEqual(next);
  expect(await db.vaults.get(history.id)).toEqual(history);
  expect((await db.archives.toArray())[0]?.row).toEqual(row);
  expect(
    await db.settings.get(
      `retired-automatic-device:${user}:${original.device}`,
    ),
  ).toBeDefined();
  expect(
    await replaceRevokedAutomaticDevice(db, user, "current", original.device),
  ).toEqual(next);
});
it("refuses credential rotation over an existing current-trip journal, including a fully synced journal", async () => {
  const original = await createAutomaticDeviceSecrets(db, user);
  await db.vaults.add({
    id: `${user}:current`,
    user,
    trip: "current",
    salt: [],
    iv: [],
    cipher: [1],
    pending: 0,
    review: 0,
    updated: "",
  });
  await expect(
    replaceRevokedAutomaticDevice(db, user, "current", original.device),
  ).rejects.toThrow("Keep this phone's saved data");
  expect(await getAutomaticDeviceSecrets(db, user)).toEqual(original);
});
it("keeps the automatic encryption key when only archived evidence remains", async () => {
  await createAutomaticDeviceSecrets(db, user);
  await db.archives.add({
    id: crypto.randomUUID(),
    kind: "RECORDS",
    preservedAt: new Date().toISOString(),
    row: {
      id: `${user}:trip`,
      user,
      trip: "trip",
      pending: 0,
      review: 0,
      salt: [],
      iv: [],
      cipher: [1, 2],
      updated: "",
    },
  });
  await expect(clearAutomaticDeviceSecrets(db, user)).rejects.toThrow(
    "Keep this phone's saved data",
  );
  expect(await getAutomaticDeviceSecrets(db, user)).toBeDefined();
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
  await expect(unlockDevice(db, user, "5828")).rejects.toThrow("Incorrect PIN");
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
  await saveTrustedDevice(db, user, "7482", secrets);
  await expect(unlockDevice(db, user, pin)).rejects.toThrow("Incorrect PIN");
  expect(await unlockDevice(db, user, "7482")).toEqual(secrets);
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
  for (const invalid of ["1234", "123456", "654321", "000000", "abc5829"])
    expect(() => validatePin(invalid)).toThrow();
  expect(() => validatePin(pin)).not.toThrow();
});
it("an unregistered device cannot unlock or assume biometric capability", async () => {
  await expect(unlockDevice(db, user, pin)).rejects.toThrow(
    "Activate this device online",
  );
  expect(await biometricsAvailable()).toBe(false);
});
