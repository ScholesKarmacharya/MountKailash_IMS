import type { OfflineDatabase } from "./store";

export type DeviceSecrets = { secret: string; device: string; token: string };
type AutomaticDevice = DeviceSecrets & { requiresSignIn: boolean };
const automaticKey = (user: string) => `automatic-device:${user}`;
export async function getAutomaticDeviceSecrets(
  db: OfflineDatabase,
  user: string,
) {
  const row = await db.settings.get(automaticKey(user));
  if (!row) return undefined;
  const value = JSON.parse(row.value) as AutomaticDevice;
  if (value.requiresSignIn)
    throw new Error(
      "Sign in online again. Your saved changes are on this phone.",
    );
  return { secret: value.secret, device: value.device, token: value.token };
}
export async function saveAutomaticDeviceSecrets(
  db: OfflineDatabase,
  user: string,
  secrets: DeviceSecrets,
) {
  // Insert once, including across tabs. Never replace a key that encrypts history.
  return db.transaction("rw", db.settings, async () => {
    const existing = await getAutomaticDeviceSecrets(db, user);
    if (existing) return existing;
    await db.settings.add({
      key: automaticKey(user),
      value: JSON.stringify({ ...secrets, requiresSignIn: false }),
    });
    return secrets;
  });
}
export async function createAutomaticDeviceSecrets(
  db: OfflineDatabase,
  user: string,
) {
  const hex = () =>
    Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
  return saveAutomaticDeviceSecrets(db, user, {
    secret: hex(),
    device: crypto.randomUUID(),
    token: hex(),
  });
}
// Called only after the online server confirms an admin-authorized replacement
// for an unprepared trip. Keep the encryption key and all previous evidence.
export async function replaceRevokedAutomaticDevice(
  db: OfflineDatabase,
  user: string,
  trip: string,
  expectedDevice: string,
) {
  return db.transaction(
    "rw",
    db.settings,
    db.preparations,
    db.archives,
    db.vaults,
    async () => {
      const current = await getAutomaticDeviceSecrets(db, user);
      if (!current) throw new Error("Offline preparation needs internet.");
      if (current.device !== expectedDevice) return current;
      if (await db.vaults.get(`${user}:${trip}`))
        throw new Error(
          "Keep this phone's saved data until the admin has reviewed it.",
        );
      const setup = await db.preparations.get(`${user}:${trip}`);
      if (setup) {
        await db.archives.add({
          id: crypto.randomUUID(),
          kind: "SETUP",
          row: setup,
          preservedAt: new Date().toISOString(),
        });
        await db.preparations.delete(setup.id);
      }
      const old = await db.settings.get(automaticKey(user));
      await db.settings.put({
        key: `retired-automatic-device:${user}:${current.device}`,
        value: old!.value,
      });
      const next = {
        secret: current.secret,
        device: crypto.randomUUID(),
        token: Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
          b.toString(16).padStart(2, "0"),
        ).join(""),
      };
      await db.settings.put({
        key: automaticKey(user),
        value: JSON.stringify({ ...next, requiresSignIn: false }),
      });
      return next;
    },
  );
}
export async function clearAutomaticDeviceSecrets(
  db: OfflineDatabase,
  user: string,
) {
  await db.transaction(
    "rw",
    db.settings,
    db.vaults,
    db.preparations,
    db.archives,
    async () => {
      if (
        (await db.vaults.where("user").equals(user).count()) ||
        (await db.preparations.where("user").equals(user).count()) ||
        (await db.archives.filter((entry) => entry.row.user === user).count())
      )
        throw new Error(
          "Keep this phone's saved data until the admin has reviewed it.",
        );
      await db.settings.delete(automaticKey(user));
    },
  );
}
type Box = { iv: number[]; cipher: number[] };
export type TrustedDevice = {
  user: string;
  device: string;
  salt: number[];
  box: Box;
  attempts: number;
  retryAt: number;
  requiresSignIn: boolean;
  biometric?: { credential: number[]; salt: number[]; box: Box };
};
const keyName = (user: string) => `trusted-device:${user}`;
const tabId = crypto.randomUUID();
export const deviceTabId = () => tabId;
export async function trustedDevice(db: OfflineDatabase, user: string) {
  const row = await db.settings.get(keyName(user));
  return row ? (JSON.parse(row.value) as TrustedDevice) : undefined;
}
async function put(db: OfflineDatabase, row: TrustedDevice) {
  await db.settings.put({ key: keyName(row.user), value: JSON.stringify(row) });
}
export function validatePin(pin: string) {
  if (
    !/^\d{4}$/.test(pin) ||
    /^(.)\1+$/.test(pin) ||
    "01234567890123456789".includes(pin) ||
    "98765432109876543210".includes(pin)
  ) {
    throw new Error(
      "Choose a 4-digit PIN; avoid repeated or consecutive digits.",
    );
  }
}
async function pinKey(pin: string, salt: number[]) {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pin),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: new Uint8Array(salt),
      iterations: 600000,
      hash: "SHA-256",
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}
async function seal(
  user: string,
  secrets: DeviceSecrets,
  key: CryptoKey,
): Promise<Box> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(user) },
    key,
    new TextEncoder().encode(JSON.stringify(secrets)),
  );
  return { iv: [...iv], cipher: [...new Uint8Array(cipher)] };
}
async function unseal(
  user: string,
  box: Box,
  key: CryptoKey,
): Promise<DeviceSecrets> {
  const value = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: new Uint8Array(box.iv),
      additionalData: new TextEncoder().encode(user),
    },
    key,
    new Uint8Array(box.cipher),
  );
  return JSON.parse(new TextDecoder().decode(value));
}
export async function saveTrustedDevice(
  db: OfflineDatabase,
  user: string,
  pin: string,
  secrets: DeviceSecrets,
) {
  validatePin(pin);
  const old = await trustedDevice(db, user);
  if (old && old.device !== secrets.device)
    throw new Error(
      "Another device setup already exists. Keep its records and contact the admin.",
    );
  const salt = [...crypto.getRandomValues(new Uint8Array(16))];
  const row: TrustedDevice = {
    user,
    device: secrets.device,
    salt,
    box: await seal(user, secrets, await pinKey(pin, salt)),
    attempts: 0,
    retryAt: 0,
    requiresSignIn: false,
  };
  await put(db, row);
  return row;
}
export async function unlockDevice(
  db: OfflineDatabase,
  user: string,
  pin: string,
) {
  // Reserve an attempt durably before expensive crypto; multiple tabs cannot
  // each reuse the same last allowed attempt. A crash counts as a failed try.
  const row = await db.transaction("rw", db.settings, async () => {
    const row = await trustedDevice(db, user);
    if (!row)
      throw new Error(
        "Activate this device online before using offline access.",
      );
    if (row.requiresSignIn)
      throw new Error("Sign in online again. Device records are preserved.");
    if (row.retryAt > Date.now())
      throw new Error(
        "Too many unlock attempts. Wait before trying again or recover access online.",
      );
    row.attempts++;
    if (row.attempts >= 5)
      row.retryAt =
        Date.now() +
        Math.min(3600000, 30000 * 2 ** Math.min(row.attempts - 5, 7));
    await put(db, row);
    return row;
  });
  let secrets: DeviceSecrets;
  try {
    secrets = await unseal(user, row.box, await pinKey(pin, row.salt));
  } catch {
    throw new Error("Incorrect PIN. Your saved records are preserved.");
  }
  await db.transaction("rw", db.settings, async () => {
    const latest = await trustedDevice(db, user);
    if (
      !latest ||
      latest.requiresSignIn ||
      JSON.stringify(latest.box) !== JSON.stringify(row.box)
    )
      throw new Error("Sign in online again. Device records are preserved.");
    await put(db, { ...latest, attempts: 0, retryAt: 0 });
  });
  return secrets;
}
export async function requireDeviceSignIn(
  db: OfflineDatabase,
  user: string,
  required: boolean,
) {
  await db.transaction("rw", db.settings, async () => {
    const automatic = await db.settings.get(automaticKey(user));
    if (automatic)
      await db.settings.put({
        ...automatic,
        value: JSON.stringify({
          ...JSON.parse(automatic.value),
          requiresSignIn: required,
        }),
      });
    const row = await trustedDevice(db, user);
    if (row) await put(db, { ...row, requiresSignIn: required });
  });
}
export async function biometricsAvailable() {
  return (
    typeof PublicKeyCredential !== "undefined" &&
    isSecureContext &&
    (await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable().catch(
      () => false,
    ))
  );
}
async function biometricKey(credential: number[], salt: number[]) {
  const result = (await navigator.credentials.get({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      allowCredentials: [
        { id: new Uint8Array(credential), type: "public-key" },
      ],
      userVerification: "required",
      extensions: { prf: { eval: { first: new Uint8Array(salt) } } },
    },
  })) as PublicKeyCredential | null;
  if (
    !result ||
    !(
      new DataView(
        (result.response as AuthenticatorAssertionResponse).authenticatorData,
      ).getUint8(32) & 4
    )
  )
    throw new Error("Secure device unlock was not confirmed. Use your PIN.");
  const prf = result.getClientExtensionResults().prf?.results?.first;
  if (!prf)
    throw new Error(
      "Secure biometric encryption is unavailable on this device. Use your PIN.",
    );
  return crypto.subtle.importKey("raw", prf, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}
export async function enableBiometric(
  db: OfflineDatabase,
  user: string,
  secrets: DeviceSecrets,
) {
  if (!(await biometricsAvailable()))
    throw new Error(
      "Secure biometric encryption is unavailable on this device. Use your PIN.",
    );
  const credential = (await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: "Mount Kailash" },
      user: {
        id: new TextEncoder().encode(user),
        name: user,
        displayName: "Mount Kailash Driver",
      },
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },
        { type: "public-key", alg: -257 },
      ],
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        userVerification: "required",
      },
      extensions: { prf: {} },
    },
  })) as PublicKeyCredential | null;
  if (!credential?.getClientExtensionResults().prf?.enabled)
    throw new Error(
      "Secure biometric encryption is unavailable on this device. Use your PIN.",
    );
  const id = [...new Uint8Array(credential.rawId)],
    salt = [...crypto.getRandomValues(new Uint8Array(32))];
  const box = await seal(user, secrets, await biometricKey(id, salt));
  const row = await trustedDevice(db, user);
  if (!row || row.requiresSignIn || row.device !== secrets.device)
    throw new Error("Sign in online again. Device records are preserved.");
  await put(db, { ...row, biometric: { credential: id, salt, box } });
}
export async function unlockBiometric(db: OfflineDatabase, user: string) {
  const row = await trustedDevice(db, user);
  if (!row?.biometric || row.requiresSignIn)
    throw new Error("Sign in online again. Device records are preserved.");
  const secrets = await unseal(
    user,
    row.biometric.box,
    await biometricKey(row.biometric.credential, row.biometric.salt),
  );
  if ((await trustedDevice(db, user))?.requiresSignIn)
    throw new Error("Sign in online again. Device records are preserved.");
  return secrets;
}
export async function lockDriverApp() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("mk-offline-locked", { detail: { app: true } }),
  );
  const channel = new BroadcastChannel("mk-offline-session");
  channel.postMessage({ app: true, source: tabId });
  channel.close();
}
