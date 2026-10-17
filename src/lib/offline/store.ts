import Dexie, { type Table } from "dexie";
import { requireDeviceSignIn } from "./device";
import { installConfirmedSnapshot } from "@/domain/offline/snapshot";
import type {
  Envelope,
  LocalState,
  OfflineKind,
  OfflineSnapshot,
  Receipt,
  DeliveryDraft,
  ContactDraft,
  CollectionDraft,
} from "@/domain/offline/types";
import {
  canonical,
  fingerprint,
  confirmAcknowledgement,
  validateDelivery,
  localCustomers,
  customerEstimate,
  effectivePrice,
  houseEvidence,
  validateEnvelope,
  validateCollection,
} from "@/domain/offline/operations";

export type VaultRow = {
  id: string;
  user: string;
  trip: string;
  salt: number[];
  iv: number[];
  cipher: number[];
  pending: number;
  review: number;
  retired?: boolean;
  updated: string;
};
type Setting = { key: string; value: string };
type Lease = { key: string; owner: string; expires: number };
type ArchivedOfflineData = {
  id: string;
  kind: "SETUP" | "RECORDS";
  row: VaultRow;
  preservedAt: string;
};
export class OfflineLocalDataError extends Error {
  constructor(
    readonly kind: "SETUP" | "RECORDS",
    message: string,
  ) {
    super(message);
  }
}
export class OfflineDatabase extends Dexie {
  vaults!: Table<VaultRow>;
  settings!: Table<Setting>;
  leases!: Table<Lease>;
  preparations!: Table<VaultRow>;
  archives!: Table<ArchivedOfflineData>;
  constructor(name = "mount-kailash-offline") {
    super(name, { chromeTransactionDurability: "strict" });
    this.version(1).stores({
      vaults: "id,user,trip",
      settings: "key",
      leases: "key",
    });
    this.version(2).stores({ preparations: "id,user,trip" });
    this.version(3).stores({ archives: "id,kind" });
  }
}
export function offlineDB() {
  return new OfflineDatabase();
}
export function storageMessage(error: unknown) {
  const name = error instanceof Error ? error.name : "";
  return name.includes("Quota")
    ? "Device storage is full. This operation was not saved. Sync or export existing records before freeing space."
    : name === "Error" && error instanceof Error
      ? error.message
      : "Device records could not be read or saved. Do not clear browser data. Try again or export your backup.";
}
async function derive(passphrase: string, salt: Uint8Array) {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt as Uint8Array<ArrayBuffer>,
      iterations: 210000,
      hash: "SHA-256",
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}
async function decrypt(row: VaultRow, key: CryptoKey): Promise<LocalState> {
  const bytes = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: new Uint8Array(row.iv),
      additionalData: new TextEncoder().encode(row.id),
    },
    key,
    new Uint8Array(row.cipher),
  );
  const state = JSON.parse(new TextDecoder().decode(bytes)) as LocalState;
  if (
    state.version !== 1 ||
    state.user !== row.user ||
    state.snapshot.round.trip_id !== row.trip ||
    !Array.isArray(state.operations)
  )
    throw new Error("Device records need recovery. Do not clear browser data.");
  for (let i = 0; i < state.operations.length; i++) {
    const op = state.operations[i]!;
    validateEnvelope(op);
    if (
      op.sequence !== (state.inheritedReceipts?.length ?? 0) + i + 1 ||
      op.trip !== row.trip ||
      !["PENDING", "SYNCED", "NEEDS_REVIEW"].includes(op.status) ||
      (await fingerprint(op.payload)) !== op.fingerprint
    )
      throw new Error(
        "Device records need recovery. Do not clear browser data.",
      );
  }
  return state;
}
async function encrypt(
  row: VaultRow,
  state: LocalState,
  key: CryptoKey,
): Promise<VaultRow> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(row.id) },
    key,
    new TextEncoder().encode(JSON.stringify(state)),
  );
  return {
    ...row,
    iv: [...iv],
    cipher: [...new Uint8Array(cipher)],
    pending: state.operations.filter((o) => o.status !== "SYNCED").length,
    review: state.operations.filter((o) => o.status === "NEEDS_REVIEW").length,
    retired: !!state.retired,
    updated: new Date().toISOString(),
  };
}
export class OfflineVault {
  constructor(
    readonly db: OfflineDatabase,
    readonly id: string,
    private readonly key: CryptoKey,
  ) {}
  static async prepare(
    db: OfflineDatabase,
    user: string,
    trip: string,
    passphrase: string,
    existing?: { device: string; token: string },
    replaceUnreadableSetup = false,
  ) {
    if (passphrase.length < 8)
      throw new Error(
        "Use an offline passphrase of at least eight characters.",
      );
    const id = `${user}:${trip}`,
      old = await db.preparations.get(id);
    let unreadable: VaultRow | undefined;
    if (old) {
      try {
        const key = await derive(passphrase, new Uint8Array(old.salt));
        const bytes = await crypto.subtle.decrypt(
          {
            name: "AES-GCM",
            iv: new Uint8Array(old.iv),
            additionalData: new TextEncoder().encode(id),
          },
          key,
          new Uint8Array(old.cipher),
        );
        return JSON.parse(new TextDecoder().decode(bytes)) as {
          device: string;
          token: string;
        };
      } catch {
        if (!replaceUnreadableSetup)
          throw new OfflineLocalDataError(
            "SETUP",
            "Unable to unlock. Check your offline passphrase or keep the encrypted backup for recovery.",
          );
        unreadable = old;
      }
    }
    const device = existing?.device ?? crypto.randomUUID(),
      token =
        existing?.token ??
        Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
          b.toString(16).padStart(2, "0"),
        ).join("");
    const salt = crypto.getRandomValues(new Uint8Array(16)),
      iv = crypto.getRandomValues(new Uint8Array(12)),
      key = await derive(passphrase, salt);
    const cipher = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(id) },
      key,
      new TextEncoder().encode(JSON.stringify({ device, token })),
    );
    const prepared: VaultRow = {
      id,
      user,
      trip,
      salt: [...salt],
      iv: [...iv],
      cipher: [...new Uint8Array(cipher)],
      pending: 0,
      review: 0,
      updated: new Date().toISOString(),
    };
    await db.transaction(
      "rw",
      db.preparations,
      db.vaults,
      db.archives,
      async () => {
        const current = await db.preparations.get(id);
        if (unreadable) {
          const records = await db.vaults.get(id);
          if (
            JSON.stringify(current) !== JSON.stringify(unreadable) ||
            (records && (records.pending !== 0 || records.review !== 0))
          )
            throw new OfflineLocalDataError(
              "RECORDS",
              "Keep this phone's saved data until the admin has reviewed it.",
            );
          // Setup contains only registration credentials, never delivery records.
          // Preserve its exact ciphertext before reserving automatic credentials.
          await db.archives.add({
            id: crypto.randomUUID(),
            kind: "SETUP",
            row: unreadable,
            preservedAt: new Date().toISOString(),
          });
          await db.preparations.put(prepared);
        } else {
          await db.preparations.add(prepared);
        }
      },
    );
    return { device, token };
  }
  static async create(
    db: OfflineDatabase,
    snapshot: OfflineSnapshot,
    device: string,
    token: string,
    passphrase: string,
    replaceUnreadable?: VaultRow,
  ) {
    if (passphrase.length < 8)
      throw new Error(
        "Use an offline passphrase of at least eight characters.",
      );
    const id = `${snapshot.profile.id}:${snapshot.round.trip_id}`;
    const old = await db.vaults.get(id);
    if (old && !replaceUnreadable)
      throw new Error(
        "An offline copy already exists. Unlock it to preserve pending records.",
      );
    const salt = crypto.getRandomValues(new Uint8Array(16)),
      key = await derive(passphrase, salt);
    const state: LocalState = {
      version: 1,
      user: snapshot.profile.id,
      device,
      token,
      snapshot,
      locale: snapshot.locale,
      operations: [],
      inheritedReceipts: snapshot.receipts.filter(
        (r) => r.status === "CONFIRMED",
      ),
      sealed: ["SEALED", "EXCEPTION"].includes(snapshot.round.phase),
      paused: snapshot.round.phase === "PAUSED",
      recovery: [],
    };
    // Adopt only exact, server-received envelopes. Unreported old-phone records
    // remain on that phone for admin review; they can never be invented here.
    for (const value of snapshot.retainedOperations ?? []) {
      const op = validateEnvelope(value);
      const receipt = snapshot.receipts.find((r) => r.id === op.id);
      if (
        op.trip !== snapshot.round.trip_id ||
        op.sequence !==
          state.inheritedReceipts!.length + state.operations.length + 1 ||
        (await fingerprint(op.payload)) !== op.fingerprint ||
        !receipt ||
        receipt.trip !== op.trip ||
        receipt.sequence !== op.sequence ||
        receipt.fingerprint !== op.fingerprint ||
        receipt.status === "CONFIRMED"
      )
        throw new Error(
          "Server confirmation did not match. The record remains on this device.",
        );
      state.operations.push({
        ...op,
        status: receipt.status === "RETRYABLE" ? "PENDING" : "NEEDS_REVIEW",
        attempts: 0,
        retryAt: 0,
        message: receipt.message ?? undefined,
      });
    }
    if (
      snapshot.receipts.some(
        (r) =>
          r.status !== "CONFIRMED" &&
          !state.operations.some((o) => o.id === r.id),
      )
    )
      throw new Error(
        "Server confirmation did not match. The record remains on this device.",
      );
    installConfirmedSnapshot(state, snapshot);
    const row = await encrypt(
      {
        id,
        user: state.user,
        trip: snapshot.round.trip_id,
        salt: [...salt],
        iv: [],
        cipher: [],
        pending: 0,
        review: 0,
        updated: "",
      },
      state,
      key,
    );
    await db.transaction(
      "rw",
      db.vaults,
      db.settings,
      db.archives,
      async () => {
        if (replaceUnreadable) {
          const current = await db.vaults.get(id);
          if (
            replaceUnreadable.id !== id ||
            current?.pending !== 0 ||
            current.review !== 0 ||
            JSON.stringify(current) !== JSON.stringify(replaceUnreadable)
          )
            throw new OfflineLocalDataError(
              "RECORDS",
              "Keep this phone's saved data until the admin has reviewed it.",
            );
          // Rebuild only a zero-pending copy from an authorized server snapshot.
          // The old ciphertext (with its original AAD/id) remains recoverable.
          await db.archives.add({
            id: crypto.randomUUID(),
            kind: "RECORDS",
            row: current,
            preservedAt: new Date().toISOString(),
          });
          await db.vaults.put(row);
        } else {
          await db.vaults.add(row);
        }
        await db.settings.put({ key: "active-user", value: state.user });
      },
    );
    return new OfflineVault(db, id, key);
  }
  static async unlock(db: OfflineDatabase, id: string, passphrase: string) {
    const row = await db.vaults.get(id);
    if (!row)
      throw new Error(
        "Device records are unavailable. Do not clear browser data.",
      );
    try {
      const key = await derive(passphrase, new Uint8Array(row.salt));
      await decrypt(row, key);
      return new OfflineVault(db, id, key);
    } catch {
      throw new OfflineLocalDataError(
        "RECORDS",
        "Unable to unlock. Check your offline passphrase or keep the encrypted backup for recovery.",
      );
    }
  }
  async read() {
    const row = await this.db.vaults.get(this.id);
    if (!row) throw new Error("Device records are unavailable.");
    return decrypt(row, this.key);
  }
  async mutate(update: (state: LocalState) => void | Promise<void>) {
    let saved!: LocalState;
    await this.db.transaction(
      "rw",
      this.db.vaults,
      this.db.settings,
      async () => {
        const row = await this.db.vaults.get(this.id);
        if (!row) throw new Error("Device records are unavailable.");
        const state = await Dexie.waitFor(decrypt(row, this.key));
        await Dexie.waitFor(Promise.resolve(update(state)));
        await this.db.vaults.put(
          await Dexie.waitFor(encrypt(row, state, this.key)),
        );
        saved = state;
      },
    );
    if (typeof window !== "undefined")
      window.dispatchEvent(new Event("mk-offline-changed"));
    return saved;
  }
  async record(
    kind: OfflineKind,
    value: unknown,
    id = crypto.randomUUID(),
    occurredAt = new Date().toISOString(),
  ) {
    return this.mutate(async (state) => {
      if (state.retired)
        throw new Error(
          state.retired.cancelled
            ? "This trip was cancelled. Open your current trip."
            : "This trip is no longer current. Open your current trip.",
        );
      if (state.operations.some((o) => o.id === id))
        throw new Error(
          "This transaction is already saved on this device. Retry synchronization with its original ID.",
        );
      if ((await this.db.settings.get("active-user"))?.value !== state.user)
        throw new Error(
          "Sign in as the owner of these device records before synchronization.",
        );
      if (state.paused)
        throw new Error(
          "This trip is paused for carryover. Resume online after admin authorization.",
        );
      if (state.snapshot.round.phase === "PREPARED")
        throw new Error(
          "Start this prepared trip online and synchronize before recording deliveries.",
        );
      if (state.sealed || state.snapshot.round.phase !== "ACTIVE")
        throw new Error(
          "This delivery round is sealed. No new sales can be recorded.",
        );
      if (Date.now() > Date.parse(state.snapshot.authorizedUntil))
        throw new Error(
          "Reconnect to renew driver authorization. Your saved records remain on this device.",
        );
      if (state.operations.some((o) => o.status === "NEEDS_REVIEW"))
        throw new Error(
          "Resolve records needing review before recording more sales.",
        );
      const draft = structuredClone(value);
      if (kind === "PAYMENT")
        validateCollection(state, draft as CollectionDraft);
      if (kind === "DELIVERY" || kind === "INSTANT") {
        const delivery = draft as DeliveryDraft;
        if ((kind === "INSTANT") !== !!delivery.instant)
          throw new Error("Invalid one-time customer reference.");
        validateDelivery(state, delivery);
        const house = houseEvidence(state, delivery);
        if (house) delivery.house = house;
        else delete delivery.house;
        delivery.prices = delivery.items.map((i) => ({
          product_id: i.product_id,
          price: effectivePrice(state, delivery.customer, i.product_id),
        }));
        delivery.custody = delivery.customer
          ? delivery.items
              .filter(
                (i) =>
                  state.snapshot.workspace.products.find(
                    (p) => p.id === i.product_id,
                  )?.kind === "FULL_JAR",
              )
              .map((i) => ({
                product_id: i.product_id,
                quantity: customerEstimate(
                  state,
                  delivery.customer!,
                  i.product_id,
                ).estimated,
              }))
          : [];
      }
      if (kind === "CUSTOMER" || kind === "CONTACT") {
        const contact = draft as ContactDraft;
        if (
          !contact.name.trim() ||
          contact.name.length > 120 ||
          contact.phone.length > 40 ||
          contact.address.length > 500 ||
          contact.shop_name.length > 160
        )
          throw new Error("Enter valid customer contact details.");
        const customers = localCustomers(state),
          previous = customers.find((c) => c.id === contact.id);
        if (
          kind === "CONTACT" &&
          (!previous || previous.version !== contact.version)
        )
          throw new Error(
            "Customer changed; reload the contact details before saving.",
          );
        if (
          customers.some(
            (c) =>
              c.id !== contact.id &&
              ((contact.phone.replace(/\D/g, "") &&
                c.phone.replace(/\D/g, "") ===
                  contact.phone.replace(/\D/g, "")) ||
                (c.name.trim().toLowerCase() ===
                  contact.name.trim().toLowerCase() &&
                  c.shop_name.trim().toLowerCase() ===
                    contact.shop_name.trim().toLowerCase())),
          )
        )
          throw new Error(
            "A matching customer already exists. Search and select it.",
          );
      }
      if (kind === "SUBMIT" || kind === "PAUSE") {
        (draft as { manifest: unknown }).manifest = [
          ...(state.inheritedReceipts ?? []),
          ...state.operations,
        ].map((o) => ({ id: o.id, fingerprint: o.fingerprint }));
        if (kind === "SUBMIT") state.sealed = true;
        else state.paused = true;
      }
      const payload = canonical(draft);
      const operation: Envelope = {
        version: 1,
        id,
        trip: state.snapshot.round.trip_id,
        sequence:
          (state.inheritedReceipts?.length ?? 0) + state.operations.length + 1,
        kind,
        occurredAt,
        payload,
        fingerprint: await fingerprint(payload),
      };
      state.operations.push({
        ...operation,
        status: "PENDING",
        attempts: 0,
        retryAt: 0,
      });
    });
  }
  async acknowledge(e: Envelope, receipt: Receipt) {
    confirmAcknowledgement(e, receipt);
    return this.mutate((state) => {
      const op = state.operations.find((o) => o.id === e.id);
      if (!op || op.fingerprint !== e.fingerprint)
        throw new Error(
          "Server confirmation did not match. The record remains on this device.",
        );
      op.status = "SYNCED";
      op.acknowledgement = receipt;
      op.message = undefined;
      state.lastSynced = receipt.processedAt;
    });
  }
  async installSnapshot(snapshot: OfflineSnapshot) {
    return this.mutate((state) => installConfirmedSnapshot(state, snapshot));
  }
  async exportBackup() {
    const row = await this.db.vaults.get(this.id);
    if (!row) throw new Error("Device records are unavailable.");
    return JSON.stringify({
      application: "Mount Kailash encrypted offline backup",
      version: 1,
      row,
    });
  }
}
export async function lockOfflineUser() {
  if (
    typeof indexedDB === "undefined" ||
    !(await Dexie.exists("mount-kailash-offline"))
  )
    return;
  const db = offlineDB();
  try {
    const user = (await db.settings.get("active-user"))?.value;
    if (user) await requireDeviceSignIn(db, user, true);
    await db.settings.put({ key: "active-user", value: "" });
    if (typeof window !== "undefined")
      window.dispatchEvent(new Event("mk-offline-locked"));
    const channel = new BroadcastChannel("mk-offline-session");
    channel.postMessage({ lock: true });
    channel.close();
  } finally {
    db.close();
  }
}
export async function offlinePending(user?: string) {
  if (
    typeof indexedDB === "undefined" ||
    !(await Dexie.exists("mount-kailash-offline"))
  )
    return 0;
  const db = offlineDB();
  try {
    const active = user ?? (await db.settings.get("active-user"))?.value;
    return active
      ? (await db.vaults.where("user").equals(active).toArray()).reduce(
          (n, r) => n + r.pending,
          0,
        )
      : 0;
  } finally {
    db.close();
  }
}
