import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Dexie from "dexie";
import { OfflineDatabase, OfflineVault } from "@/lib/offline/store";
import { emptyWorkspace } from "@/domain/operations/types";
import { emptyFinance } from "@/domain/finance/types";
import {
  localStock,
  customerEstimate,
  canonical,
  fingerprint,
} from "@/domain/offline/operations";
import { SyncController, SyncError } from "@/lib/offline/sync";
import {
  projectedWorkspace,
  projectedCustomer,
} from "@/domain/offline/projection";
import type {
  OfflineSnapshot,
  DeliveryDraft,
  Receipt,
} from "@/domain/offline/types";
import {
  projectedInstants,
  cachedInstantHistory,
} from "@/domain/offline/instant";
const user = crypto.randomUUID(),
  trip = crypto.randomUUID(),
  jar = crypto.randomUUID(),
  carton = crypto.randomUUID(),
  customer = crypto.randomUUID(),
  vehicle = crypto.randomUUID(),
  device = crypto.randomUUID(),
  location = crypto.randomUUID();
let db: OfflineDatabase, vault: OfflineVault;
export function snapshot(): OfflineSnapshot {
  return {
    profile: {
      id: user,
      name: "Test driver",
      role: "DRIVER",
      is_active: true,
      approval_status: "APPROVED",
    },
    locale: "en",
    round: {
      trip_id: trip,
      driver_id: user,
      device_id: device,
      phase: "ACTIVE",
      confirmed_sequence: 0,
      registered_at: new Date().toISOString(),
      last_seen_at: new Date().toISOString(),
      reported_pending: 0,
      checkpoint_at: null,
    },
    receipts: [],
    finance: structuredClone(emptyFinance),
    contexts: [
      {
        customer: {
          id: customer,
          name: "Hotel",
          shop_name: "",
          phone: "",
          address: "",
          notes: "",
          is_active: true,
          version: 1,
          supply_type: "REGULAR",
          house_status: "NONE",
        },
        billing: null,
        prices: [],
        credit: [],
        custody: [],
        custody_history: [],
        credit_history: [],
      },
    ],
    fetchedAt: new Date().toISOString(),
    authorizedUntil: new Date(Date.now() + 86400000).toISOString(),
    workspace: {
      ...structuredClone(emptyWorkspace),
      available: true,
      products: [
        {
          id: jar,
          sku: "JAR",
          name: "20L",
          kind: "FULL_JAR",
          unit: "jar",
          default_price: "10.00",
          is_active: true,
          version: 1,
        },
        {
          id: carton,
          sku: "CTN",
          name: "Water",
          kind: "BOTTLE_CARTON",
          unit: "carton",
          default_price: "20.00",
          is_active: true,
          version: 1,
        },
      ],
      customers: [
        {
          id: customer,
          name: "Hotel",
          shop_name: "",
          phone: "",
          address: "",
          notes: "",
          is_active: true,
          version: 1,
        },
      ],
      trips: [
        {
          id: trip,
          trip_number: 1,
          driver_id: user,
          driver_name: "Driver",
          vehicle_id: vehicle,
          plate_number: "TEST",
          business_day_id: crypto.randomUUID(),
          date_label: "2026-10-13",
          status: "ACTIVE",
          notes: "",
          created_at: new Date().toISOString(),
          close_reason: "",
        },
      ],
      vehicles: [
        {
          id: vehicle,
          plate_number: "TEST",
          location_id: location,
          description: "",
          is_active: true,
          version: 1,
        },
      ],
      loads: [
        {
          trip_id: trip,
          product_id: jar,
          stock_kind: "FULL_JAR",
          quantity: 100,
        },
        {
          trip_id: trip,
          product_id: carton,
          stock_kind: "BOTTLE_CARTON",
          quantity: 10,
        },
      ],
      balances: [
        {
          location_id: location,
          product_id: jar,
          stock_kind: "FULL_JAR",
          quantity: 100,
        },
        {
          location_id: location,
          product_id: jar,
          stock_kind: "EMPTY_JAR",
          quantity: 0,
        },
        {
          location_id: location,
          product_id: carton,
          stock_kind: "BOTTLE_CARTON",
          quantity: 10,
        },
      ],
    },
  };
}
function sale(full = 35, empty = 30): DeliveryDraft {
  return {
    customer,
    walk_name: "",
    walk_phone: "",
    items: [
      { product_id: jar, full_jars: full, empty_jars: empty, cartons: 0 },
    ],
    status: "PAID",
    received: `${full * 10}.00`,
    total: `${full * 10}.00`,
    notes: "",
    prices: [],
    custody: [],
  };
}
beforeEach(async () => {
  db = new OfflineDatabase(`test-${crypto.randomUUID()}`);
  vault = await OfflineVault.create(
    db,
    snapshot(),
    device,
    "a".repeat(64),
    "offline-test-passphrase",
  );
});
afterEach(async () => {
  await db.delete();
});
describe("encrypted offline durability", () => {
  it("retires a superseded writer without changing any envelope and prepares a separate trip vault", async () => {
    await vault.record("DELIVERY", sale());
    const staleTab = await OfflineVault.unlock(
      db,
      vault.id,
      "offline-test-passphrase",
    );
    const before = await vault.read();
    await vault.mutate((s) => {
      s.retired = {
        status: "CLOSED",
        cancelled: true,
        at: new Date().toISOString(),
      };
    });
    expect((await vault.read()).operations).toEqual(before.operations);
    expect((await db.vaults.get(vault.id))?.retired).toBe(true);
    expect((await db.vaults.get(vault.id))?.pending).toBe(1);
    await expect(staleTab.record("DELIVERY", sale(1, 0))).rejects.toThrow(
      "cancelled",
    );
    const replacement = snapshot(),
      newTrip = crypto.randomUUID();
    replacement.round.trip_id = newTrip;
    replacement.workspace.trips = replacement.workspace.trips.map((t) => ({
      ...t,
      id: newTrip,
    }));
    replacement.workspace.loads = replacement.workspace.loads.map((l) => ({
      ...l,
      trip_id: newTrip,
    }));
    const fresh = await OfflineVault.create(
      db,
      replacement,
      device,
      "b".repeat(64),
      "offline-test-passphrase",
    );
    await fresh.record("DELIVERY", sale(1, 0));
    expect(await db.vaults.count()).toBe(2);
    expect((await fresh.read()).operations[0]?.trip).toBe(newTrip);
    expect((await vault.read()).operations).toEqual(before.operations);
    expect(
      (await fresh.read()).operations.some(
        (o) => o.id === before.operations[0]?.id,
      ),
    ).toBe(false);
  });
  it("preserves an unreadable legacy setup before reserving automatic credentials, without claiming it contains deliveries", async () => {
    await OfflineVault.prepare(db, user, trip, "old-setup-passphrase");
    const original = await db.preparations.get(vault.id);
    const credentials = { device: crypto.randomUUID(), token: "b".repeat(64) };
    expect(
      await OfflineVault.prepare(
        db,
        user,
        trip,
        "new-automatic-secret",
        credentials,
        true,
      ),
    ).toEqual(credentials);
    expect(
      await OfflineVault.prepare(
        db,
        user,
        trip,
        "new-automatic-secret",
        credentials,
        true,
      ),
    ).toEqual(credentials);
    const archives = await db.archives.toArray();
    expect(archives).toHaveLength(1);
    expect(archives[0]).toMatchObject({ kind: "SETUP", row: original });
    expect((await vault.read()).operations).toHaveLength(0);
  });
  it("never replaces a legacy setup or local journal with pending deliveries", async () => {
    await OfflineVault.prepare(db, user, trip, "old-setup-passphrase");
    await vault.record("DELIVERY", sale(1, 0));
    const original = await db.vaults.get(vault.id),
      preparation = await db.preparations.get(vault.id);
    await expect(
      OfflineVault.prepare(
        db,
        user,
        trip,
        "new-automatic-secret",
        undefined,
        true,
      ),
    ).rejects.toThrow("admin");
    await expect(
      OfflineVault.create(
        db,
        snapshot(),
        device,
        "a".repeat(64),
        "new-automatic-secret",
        original,
      ),
    ).rejects.toThrow("admin");
    expect(await db.vaults.get(vault.id)).toEqual(original);
    expect(await db.preparations.get(vault.id)).toEqual(preparation);
    expect(await db.archives.count()).toBe(0);
  });
  it("archives a zero-pending journal byte-for-byte before rebuilding from confirmed receipts", async () => {
    const op = (await vault.record("DELIVERY", sale(1, 0))).operations[0]!;
    const receipt: Receipt = {
      id: op.id,
      trip,
      sequence: 1,
      fingerprint: op.fingerprint,
      status: "CONFIRMED",
      result: crypto.randomUUID(),
      message: null,
      processedAt: new Date().toISOString(),
    };
    await vault.acknowledge(op, receipt);
    const original = (await db.vaults.get(vault.id))!;
    const fresh = snapshot();
    fresh.round.confirmed_sequence = 1;
    fresh.receipts = [receipt];
    const rebuilt = await OfflineVault.create(
      db,
      fresh,
      device,
      "a".repeat(64),
      "new-automatic-secret",
      original,
    );
    expect((await rebuilt.read()).inheritedReceipts).toEqual([receipt]);
    expect((await rebuilt.read()).operations).toHaveLength(0);
    const archive = (await db.archives.toArray())[0]!;
    expect(archive).toMatchObject({ kind: "RECORDS", row: original });
    const recovery = new OfflineDatabase(
      `archive-recovery-${crypto.randomUUID()}`,
    );
    try {
      await recovery.vaults.add(archive.row);
      const saved = await OfflineVault.unlock(
        recovery,
        vault.id,
        "offline-test-passphrase",
      );
      expect((await saved.read()).operations[0]).toMatchObject({
        ...op,
        status: "SYNCED",
        acknowledgement: receipt,
      });
    } finally {
      await recovery.delete();
    }
  });
  it("upgrades the existing IndexedDB schema without changing stored ciphertext", async () => {
    const name = `legacy-schema-${crypto.randomUUID()}`,
      original = (await db.vaults.get(vault.id))!;
    const legacy = new Dexie(name);
    legacy.version(2).stores({
      vaults: "id,user,trip",
      settings: "key",
      leases: "key",
      preparations: "id,user,trip",
    });
    await legacy.table("vaults").add(original);
    legacy.close();
    const upgraded = new OfflineDatabase(name);
    try {
      expect(await upgraded.vaults.get(vault.id)).toEqual(original);
      expect(await upgraded.archives.count()).toBe(0);
    } finally {
      await upgraded.delete();
    }
  });
  it("keeps return counts limited to assigned product and stock kinds during pending deliveries", async () => {
    const saved = await vault.record("DELIVERY", sale(5, 2));
    expect(localStock(saved).map((c) => [c.product_id, c.stock_kind])).toEqual([
      [jar, "FULL_JAR"],
      [jar, "EMPTY_JAR"],
      [carton, "BOTTLE_CARTON"],
    ]);
    expect(
      localStock(saved).find(
        (c) => c.product_id === jar && c.stock_kind === "FULL_JAR",
      )!.quantity,
    ).toBe(95);
  });
  it("retains server-received review envelopes on a replacement without skipping or changing them", async () => {
    const original = (await vault.record("DELIVERY", sale(5, 0)))
      .operations[0]!;
    const replacementDB = new OfflineDatabase(
      `review-replacement-${crypto.randomUUID()}`,
    );
    try {
      const fresh = snapshot();
      fresh.retainedOperations = [original];
      fresh.receipts = [
        {
          id: original.id,
          trip,
          sequence: 1,
          fingerprint: original.fingerprint,
          status: "NEEDS_REVIEW",
          result: null,
          message: "Review original delivery",
          processedAt: new Date().toISOString(),
        },
      ];
      const replacement = await OfflineVault.create(
        replacementDB,
        fresh,
        device,
        "a".repeat(64),
        "random-installation-secret",
      );
      const retained = (await replacement.read()).operations[0]!;
      expect(retained).toMatchObject({
        id: original.id,
        sequence: original.sequence,
        payload: original.payload,
        fingerprint: original.fingerprint,
        status: "NEEDS_REVIEW",
      });
      await expect(replacement.record("DELIVERY", sale(1, 0))).rejects.toThrow(
        "Resolve records needing review",
      );
    } finally {
      await replacementDB.delete();
    }
  });
  it("reopens a replacement journal at the confirmed sequence and seals with inherited receipts without replaying them", async () => {
    const replacementDB = new OfflineDatabase(
      `replacement-${crypto.randomUUID()}`,
    );
    try {
      const fresh = snapshot();
      fresh.round.confirmed_sequence = 1;
      fresh.workspace.balances[0]!.quantity = 90;
      const receipt: Receipt = {
        id: crypto.randomUUID(),
        trip,
        sequence: 1,
        fingerprint: "a".repeat(64),
        status: "CONFIRMED",
        result: crypto.randomUUID(),
        message: null,
        processedAt: new Date().toISOString(),
      };
      fresh.receipts = [receipt];
      const replacement = await OfflineVault.create(
        replacementDB,
        fresh,
        device,
        "a".repeat(64),
        "random-installation-secret",
      );
      const local = await replacement.record("DELIVERY", sale(5, 0));
      expect(local.operations[0]!.sequence).toBe(2);
      expect(
        localStock(local).find((c) => c.stock_kind === "FULL_JAR")!.quantity,
      ).toBe(85);
      const reopened = await OfflineVault.unlock(
        replacementDB,
        replacement.id,
        "random-installation-secret",
      );
      expect((await reopened.read()).inheritedReceipts).toEqual([receipt]);
      const tampered = structuredClone(fresh);
      tampered.receipts[0]!.fingerprint = "b".repeat(64);
      await expect(reopened.installSnapshot(tampered)).rejects.toThrow(
        "Server confirmation did not match",
      );
      const sealed = await reopened.record("SUBMIT", {
        counts: [],
        manifest: [],
      });
      expect(sealed.operations[1]!.sequence).toBe(3);
      expect(JSON.parse(sealed.operations[1]!.payload).manifest).toEqual([
        { id: receipt.id, fingerprint: receipt.fingerprint },
        {
          id: local.operations[0]!.id,
          fingerprint: local.operations[0]!.fingerprint,
        },
      ]);
    } finally {
      await replacementDB.delete();
    }
  });
  it("records a one-time reference and sale atomically, then collects empties without duplicating a sale", async () => {
    // Legacy vaults must refresh their authorized snapshot before this new UI
    // advertises entry; the operation data itself remains backward compatible.
    const legacy = await vault.read();
    expect(projectedInstants(legacy).available).toBe(false);
    legacy.snapshot.instant = { available: true, records: [] };
    expect(projectedInstants(legacy).available).toBe(true);
    const id = crypto.randomUUID(),
      draft = {
        ...sale(20, 15),
        customer: id,
        instant: {
          id,
          name: "Private wedding event",
          phone: "9801234567",
          location: "Patan",
        },
      };
    await vault.record("INSTANT", draft);
    let state = await vault.read();
    expect(
      localStock(state).find((b) => b.stock_kind === "FULL_JAR")!.quantity,
    ).toBe(80);
    expect(customerEstimate(state, id, jar).estimated).toBe(5);
    expect(
      projectedWorkspace(state).customers.find((c) => c.id === id)?.is_one_time,
    ).toBe(true);
    expect(projectedInstants(state).records[0]).toMatchObject({
      pending: 5,
      returned: 15,
      collected: "200.00",
      device: true,
    });
    expect(JSON.stringify(await db.vaults.get(vault.id))).not.toContain(
      "Private wedding event",
    );
    await vault.record("DELIVERY", {
      ...sale(0, 5),
      customer: id,
      status: "RETURN_ONLY",
      received: null,
    });
    state = await vault.read();
    expect(projectedInstants(state).records[0]).toMatchObject({
      pending: 0,
      returned: 20,
      device: true,
    });
    expect(
      projectedWorkspace(state).items.filter((i) => i.full_jars > 0),
    ).toHaveLength(1);
    expect(
      cachedInstantHistory(state, projectedInstants(state).records[0]!).jars,
    ).toHaveLength(3);
    const reopened = await OfflineVault.unlock(
      db,
      vault.id,
      "offline-test-passphrase",
    );
    expect((await reopened.read()).operations).toHaveLength(2);
    expect(projectedCustomer(await reopened.read(), id).customer.name).toBe(
      "Private wedding event",
    );
  });
  it("does not persist an Instant Delivery that omits identification for unpaid jars", async () => {
    const id = crypto.randomUUID();
    await expect(
      vault.record("INSTANT", {
        ...sale(20, 15),
        customer: id,
        instant: { id, name: "Party", phone: "", location: "Patan" },
      }),
    ).rejects.toThrow(/phone/);
    expect((await vault.read()).operations).toHaveLength(0);
    expect(
      localStock(await vault.read()).find((b) => b.stock_kind === "FULL_JAR")!
        .quantity,
    ).toBe(100);
  });
  it("keeps notification payloads and queued read acknowledgements encrypted across reopening and snapshot refresh", async () => {
    const notifications = {
      items: [
        {
          id: crypto.randomUUID(),
          sequence: 1,
          recipient_id: user,
          type: "TRIP_ASSIGNED" as const,
          entity_type: "trip" as const,
          entity_id: trip,
          trip_id: trip,
          payload: {
            driver: "Private driver name",
            vehicle: "BA-NOTIFY",
            trip_number: 1,
            scheduled_date: "2026-10-15",
            assigned_not_ready: true,
          },
          created_at: new Date().toISOString(),
          read_at: null,
        },
      ],
      unread: 1,
      fetched_at: new Date().toISOString(),
      pending_read: [crypto.randomUUID()],
    };
    await vault.mutate((state) => {
      state.notifications = notifications;
    });
    expect(JSON.stringify(await db.vaults.get(vault.id))).not.toContain(
      "Private driver name",
    );
    const reopened = await OfflineVault.unlock(
      db,
      vault.id,
      "offline-test-passphrase",
    );
    expect((await reopened.read()).notifications).toEqual(notifications);
    await reopened.installSnapshot(snapshot());
    expect((await reopened.read()).notifications).toEqual(notifications);
  });
  it("pauses with a durable complete manifest, preserves stock across reopening and resumes only after a confirmed active snapshot", async () => {
    const first = await vault.record("DELIVERY", sale(20, 5));
    const paused = await vault.record("PAUSE", { manifest: [] });
    expect(paused.paused).toBe(true);
    expect(paused.sealed).toBe(false);
    expect(JSON.parse(paused.operations[1]!.payload).manifest).toEqual([
      {
        id: first.operations[0]!.id,
        fingerprint: first.operations[0]!.fingerprint,
      },
    ]);
    const reopened = await OfflineVault.unlock(
      db,
      vault.id,
      "offline-test-passphrase",
    );
    expect((await reopened.read()).paused).toBe(true);
    await expect(reopened.record("DELIVERY", sale(1, 0))).rejects.toThrow(
      "paused",
    );
    expect(
      localStock(await reopened.read()).find(
        (b) => b.stock_kind === "FULL_JAR",
      )!.quantity,
    ).toBe(80);
    const confirmed = snapshot();
    confirmed.round.phase = "PAUSED";
    confirmed.round.confirmed_sequence = 2;
    confirmed.contexts = [];
    confirmed.receipts = paused.operations.map((o) => ({
      id: o.id,
      trip: o.trip,
      sequence: o.sequence,
      fingerprint: o.fingerprint,
      status: "CONFIRMED" as const,
      result: crypto.randomUUID(),
      message: null,
      processedAt: new Date().toISOString(),
    }));
    expect((await reopened.installSnapshot(confirmed)).paused).toBe(true);
    const resumed = snapshot();
    resumed.round.confirmed_sequence = 2;
    resumed.receipts = confirmed.receipts;
    const updated = await reopened.installSnapshot(resumed);
    expect(updated.paused).toBe(false);
    expect(updated.sealed).toBe(false);
    expect(updated.operations.map((o) => o.id)).toEqual(
      paused.operations.map((o) => o.id),
    );
  });
  it("rejects duplicate device IDs atomically without reducing inventory twice", async () => {
    const id = crypto.randomUUID();
    const results = await Promise.allSettled([
      vault.record("DELIVERY", sale(), id),
      vault.record("DELIVERY", sale(), id),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const local = await vault.read();
    expect(local.operations).toHaveLength(1);
    expect(
      localStock(local).find((c) => c.stock_kind === "FULL_JAR")?.quantity,
    ).toBe(65);
  });
  it("projects pending stock, custody and credit into the normal customer model without altering the snapshot", async () => {
    await vault.record("DELIVERY", {
      ...sale(15, 5),
      status: "CREDIT",
      received: null,
    });
    const local = await vault.read(),
      original = canonical(local);
    const w = projectedWorkspace(local),
      context = projectedCustomer(local, customer);
    expect(w.balances.find((b) => b.stock_kind === "FULL_JAR")?.quantity).toBe(
      85,
    );
    expect(w.items[0]?.full_jars).toBe(15);
    expect(context.custody[0]?.quantity).toBe(10);
    expect(context.credit[0]).toMatchObject({
      outstanding: "150.00",
      available: "0.00",
    });
    expect(canonical(local)).toBe(original);
  });
  const ack = (
    op: import("@/domain/offline/types").LocalOperation,
  ): Receipt => ({
    id: op.id,
    trip,
    sequence: op.sequence,
    fingerprint: op.fingerprint,
    status: "CONFIRMED",
    result: crypto.randomUUID(),
    message: null,
    processedAt: new Date().toISOString(),
  });
  it("installs only a receipt-covered prefix and preserves pending immutable payloads and inventory deltas", async () => {
    await vault.record("DELIVERY", sale(10, 0));
    await vault.record("DELIVERY", sale(5, 2));
    const before = await vault.read();
    const fresh = snapshot();
    fresh.round.confirmed_sequence = 1;
    fresh.receipts = [ack(before.operations[0]!)];
    fresh.workspace.balances[0]!.quantity = 90;
    fresh.workspace.customers[0]!.name = "Confirmed updated name";
    const after = await vault.installSnapshot(fresh);
    expect(after.operations.map((o) => o.status)).toEqual([
      "SYNCED",
      "PENDING",
    ]);
    for (let i = 0; i < before.operations.length; i++) {
      expect(after.operations[i]).toMatchObject({
        id: before.operations[i]!.id,
        payload: before.operations[i]!.payload,
        fingerprint: before.operations[i]!.fingerprint,
        sequence: before.operations[i]!.sequence,
      });
    }
    expect(
      localStock(after).find((b) => b.stock_kind === "FULL_JAR")!.quantity,
    ).toBe(85);
    expect(after.snapshot.workspace.customers[0]!.name).toBe(
      "Confirmed updated name",
    );
  });
  it.each([
    "missing receipt",
    "wrong fingerprint",
    "another device",
    "another driver",
    "duplicate receipt",
    "incomplete context",
  ])(
    "rejects %s atomically without replacing local pending records",
    async (failure) => {
      await vault.record("DELIVERY", sale());
      const before = await vault.read(),
        fresh = snapshot();
      fresh.round.confirmed_sequence = 1;
      fresh.receipts = [ack(before.operations[0]!)];
      fresh.workspace.balances[0]!.quantity = 65;
      if (failure === "missing receipt") fresh.receipts = [];
      if (failure === "wrong fingerprint")
        fresh.receipts[0]!.fingerprint = "b".repeat(64);
      if (failure === "another device")
        fresh.round.device_id = crypto.randomUUID();
      if (failure === "another driver") fresh.profile.id = crypto.randomUUID();
      if (failure === "duplicate receipt")
        fresh.receipts.push(fresh.receipts[0]!);
      if (failure === "incomplete context")
        fresh.contexts = [
          { customer: fresh.workspace.customers[0]! },
        ] as OfflineSnapshot["contexts"];
      await expect(vault.installSnapshot(fresh)).rejects.toThrow();
      expect(await vault.read()).toEqual(before);
    },
  );
  it("rejects delayed prepared and older snapshots after the trip has become active", async () => {
    const current = await vault.read();
    const prepared = snapshot();
    prepared.round.phase = "PREPARED";
    await expect(vault.installSnapshot(prepared)).rejects.toThrow(
      "Server confirmation did not match",
    );
    const stale = snapshot();
    stale.fetchedAt = new Date(
      Date.parse(current.snapshot.fetchedAt) - 1000,
    ).toISOString();
    await expect(vault.installSnapshot(stale)).rejects.toThrow(
      "Server confirmation did not match",
    );
    expect(await vault.read()).toEqual(current);
  });
  it("rejects regressing server snapshots and never announces success for a malformed snapshot", async () => {
    await vault.record("DELIVERY", sale());
    const op = (await vault.read()).operations[0]!,
      receipt = ack(op),
      fresh = snapshot();
    fresh.receipts = [receipt];
    fresh.round.confirmed_sequence = 1;
    await vault.installSnapshot(fresh);
    await expect(vault.installSnapshot(snapshot())).rejects.toThrow(
      /confirmation/,
    );
    const statuses: string[] = [];
    const request = async <T>(body?: Record<string, unknown>): Promise<T> => {
      if (!body) return { profile: { id: user } } as T;
      if (body.action === "checkin")
        return { round: fresh.round, receipts: [receipt] } as T;
      if (body.action === "snapshot") return snapshot() as T;
      throw new Error("Unexpected request");
    };
    await new SyncController(
      vault,
      (v) => statuses.push(v.status),
      () => {},
      request,
    ).run();
    expect(statuses).toContain("Sync Failed");
    expect(statuses).not.toContain("All Synced");
    expect((await vault.read()).snapshot.round.confirmed_sequence).toBe(1);
  });
  it("upgrades a genuine v1 database while retaining encrypted pending bytes", async () => {
    await vault.record("DELIVERY", sale());
    const row = (await db.vaults.get(vault.id))!;
    const name = `upgrade-${crypto.randomUUID()}`;
    const v1 = new Dexie(name);
    v1.version(1).stores({
      vaults: "id,user,trip",
      settings: "key",
      leases: "key",
    });
    await v1.table("vaults").put(row);
    await v1.table("settings").put({ key: "active-user", value: user });
    v1.close();
    const upgraded = new OfflineDatabase(name);
    try {
      expect(await upgraded.vaults.get(vault.id)).toEqual(row);
      const reopened = await OfflineVault.unlock(
        upgraded,
        vault.id,
        "offline-test-passphrase",
      );
      expect((await reopened.read()).operations).toHaveLength(1);
      expect(await upgraded.preparations.count()).toBe(0);
    } finally {
      await upgraded.delete();
    }
  });
  it("retains encrypted recovery evidence when ciphertext is corrupted", async () => {
    const row = (await db.vaults.get(vault.id))!;
    row.cipher[0] = row.cipher[0]! ^ 1;
    await db.vaults.put(row);
    await expect(vault.read()).rejects.toThrow();
    expect(JSON.parse(await vault.exportBackup()).row.cipher).toEqual(
      row.cipher,
    );
  });
  it("retains expired and suspended uploads without false confirmation and blocks known revoked local saves", async () => {
    await vault.record("DELIVERY", sale());
    let status = 401;
    const request = async <T>(): Promise<T> => {
      throw new SyncError(
        "AUTHENTICATION",
        "Sign in online again. Device records are preserved.",
        status,
      );
    };
    const controller = new SyncController(
      vault,
      () => {},
      () => {},
      request,
    );
    await controller.run();
    expect((await vault.read()).operations[0]!.status).toBe("PENDING");
    status = 403;
    await controller.run();
    expect((await vault.read()).operations[0]!.status).toBe("NEEDS_REVIEW");
    await expect(vault.record("DELIVERY", sale(1, 0))).rejects.toThrow(
      /authorization/,
    );
  });
  it("reports an identity network outage as offline and retains the pending operation without false session expiry", async () => {
    await vault.record("DELIVERY", sale());
    const views: import("@/lib/offline/sync").SyncView[] = [];
    const request = async <T>(): Promise<T> => {
      throw new SyncError(
        "NETWORK",
        "Network unavailable. Saved records will retry when connected.",
        503,
      );
    };
    await new SyncController(
      vault,
      (view) => views.push(view),
      () => {},
      request,
    ).run();
    expect(views.at(-1)).toMatchObject({
      connection: "Offline",
      status: "Sync Failed",
    });
    expect((await vault.read()).operations[0]!.status).toBe("PENDING");
  });
  it("does not mutate retained records after authorization expires or the active account changes", async () => {
    await vault.mutate((s) => {
      s.snapshot.authorizedUntil = new Date(0).toISOString();
    });
    await expect(vault.record("DELIVERY", sale())).rejects.toThrow(
      /authorization/,
    );
    await db.settings.put({ key: "active-user", value: crypto.randomUUID() });
    await expect(vault.record("DELIVERY", sale())).rejects.toThrow(/owner/);
    expect((await vault.read()).operations).toHaveLength(0);
  });
  it("prevents concurrent sync controllers from posting the same head together", async () => {
    await vault.record("DELIVERY", sale());
    const operation = (await vault.read()).operations[0]!;
    let posts = 0;
    const receipt: Receipt = {
      id: operation.id,
      trip,
      sequence: 1,
      fingerprint: operation.fingerprint,
      status: "CONFIRMED",
      result: crypto.randomUUID(),
      message: null,
      processedAt: new Date().toISOString(),
    };
    const request = async <T>(body?: Record<string, unknown>): Promise<T> => {
      if (!body) return { profile: { id: user } } as T;
      if (body.action === "checkin")
        return { round: snapshot().round, receipts: [] } as T;
      if (body.action === "post") {
        posts++;
        await new Promise((resolve) => setTimeout(resolve, 10));
        return receipt as T;
      }
      if (body.action === "snapshot") {
        const fresh = snapshot();
        fresh.receipts = [receipt];
        fresh.round.confirmed_sequence = 1;
        return fresh as T;
      }
      throw new Error("Unexpected request");
    };
    await Promise.all([
      new SyncController(
        vault,
        () => {},
        () => {},
        request,
      ).run(),
      new SyncController(
        vault,
        () => {},
        () => {},
        request,
      ).run(),
    ]);
    expect(posts).toBe(1);
    expect((await vault.read()).operations[0]!.status).toBe("SYNCED");
  });
  it("automatically runs again when a journal commit arrives during the final snapshot download", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let downloading = false,
      downloads = 0,
      posts = 0;
    const receipts: Receipt[] = [];
    const request = async <T>(body?: Record<string, unknown>): Promise<T> => {
      if (!body) return { profile: { id: user } } as T;
      const fresh = snapshot();
      fresh.round.confirmed_sequence = receipts.length;
      fresh.receipts = [...receipts];
      if (body.action === "checkin")
        return { round: fresh.round, receipts: fresh.receipts } as T;
      if (body.action === "snapshot") {
        if (++downloads === 1) {
          downloading = true;
          await held;
        }
        return fresh as T;
      }
      if (body.action === "post") {
        posts++;
        const op = body.operation as import("@/domain/offline/types").Envelope;
        const receipt: Receipt = {
          id: op.id,
          trip,
          sequence: op.sequence,
          fingerprint: op.fingerprint,
          status: "CONFIRMED",
          result: crypto.randomUUID(),
          message: null,
          processedAt: new Date().toISOString(),
        };
        receipts.push(receipt);
        return receipt as T;
      }
      throw new Error("Unexpected request");
    };
    const controller = new SyncController(
      vault,
      () => {},
      () => {},
      request,
    );
    const initial = controller.run();
    await vi.waitFor(() => expect(downloading).toBe(true));
    await vault.record("DELIVERY", sale(1, 0));
    await controller.run(); // Queued while the first run owns the lease.
    release();
    await initial;
    await vi.waitFor(async () =>
      expect((await vault.read()).operations[0]!.status).toBe("SYNCED"),
    );
    await vi.waitFor(() => expect(controller.running).toBe(false));
    expect(posts).toBe(1);
  });
  it.each(["native acquired", "native busy", "fallback"])(
    "recovers an orphaned lease only after exclusive browser ownership: %s",
    async (mode) => {
      await vault.record("DELIVERY", sale());
      const op = (await vault.read()).operations[0]!;
      const receipt: Receipt = {
        id: op.id,
        trip,
        sequence: 1,
        fingerprint: op.fingerprint,
        status: "CONFIRMED",
        result: crypto.randomUUID(),
        message: null,
        processedAt: new Date().toISOString(),
      };
      const key = `sync:${vault.id}`;
      await db.leases.put({
        key,
        owner: "closed-tab",
        expires: Date.now() + 60000,
      });
      let posts = 0;
      const request = async <T>(body?: Record<string, unknown>): Promise<T> => {
        if (!body) return { profile: { id: user } } as T;
        if (body.action === "checkin")
          return { round: snapshot().round, receipts: [] } as T;
        if (body.action === "post") {
          posts++;
          return receipt as T;
        }
        if (body.action === "snapshot") {
          const fresh = snapshot();
          fresh.receipts = [receipt];
          fresh.round.confirmed_sequence = 1;
          return fresh as T;
        }
        throw new Error("Unexpected request");
      };
      vi.stubGlobal(
        "navigator",
        mode === "fallback"
          ? {}
          : {
              locks: {
                request: async (
                  _name: string,
                  _options: unknown,
                  callback: (lock: unknown) => Promise<void>,
                ) => callback(mode === "native acquired" ? {} : null),
              },
            },
      );
      try {
        await new SyncController(
          vault,
          () => {},
          () => {},
          request,
        ).run();
        expect(posts).toBe(mode === "native acquired" ? 1 : 0);
        expect((await vault.read()).operations[0]!.status).toBe(
          mode === "native acquired" ? "SYNCED" : "PENDING",
        );
        if (mode === "native acquired")
          expect(await db.leases.get(key)).toBeUndefined();
        else
          expect(await db.leases.get(key)).toMatchObject({
            owner: "closed-tab",
          });
      } finally {
        vi.unstubAllGlobals();
      }
    },
  );
  it("resumes a queue after a midpoint network failure without reposting its acknowledged prefix", async () => {
    await vault.record("DELIVERY", sale(10, 0));
    await vault.record("DELIVERY", sale(10, 0));
    const operations = (await vault.read()).operations,
      receipts: Receipt[] = [];
    let fail = true;
    const posted: string[] = [];
    const request = async <T>(body?: Record<string, unknown>): Promise<T> => {
      if (!body) return { profile: { id: user } } as T;
      if (body.action === "checkin")
        return { round: snapshot().round, receipts } as T;
      if (body.action === "post") {
        const op = body.operation as (typeof operations)[number];
        posted.push(op.id);
        if (op.sequence === 2 && fail) {
          fail = false;
          throw new SyncError("TEMPORARY", "Disconnected");
        }
        const receipt: Receipt = {
          id: op.id,
          trip,
          sequence: op.sequence,
          fingerprint: op.fingerprint,
          status: "CONFIRMED",
          result: crypto.randomUUID(),
          message: null,
          processedAt: new Date().toISOString(),
        };
        receipts.push(receipt);
        return receipt as T;
      }
      if (body.action === "snapshot") {
        const snap = snapshot();
        snap.receipts = [...receipts];
        snap.round.confirmed_sequence = receipts.length;
        snap.workspace.balances[0]!.quantity = 100 - 10 * receipts.length;
        return snap as T;
      }
      throw new Error("Unexpected request");
    };
    const controller = new SyncController(
      vault,
      () => {},
      () => {},
      request,
    );
    await controller.run();
    expect((await vault.read()).operations.map((o) => o.status)).toEqual([
      "SYNCED",
      "PENDING",
    ]);
    await controller.run(true);
    expect(posted.filter((id) => id === operations[0]!.id)).toHaveLength(1);
    expect(
      (await vault.read()).operations.every((o) => o.status === "SYNCED"),
    ).toBe(true);
    expect(localStock(await vault.read())[0]!.quantity).toBe(80);
  });
  it("persists stock, original UUIDs, dates and customer links after database reopening", async () => {
    await vault.record("DELIVERY", sale());
    const before = await vault.read();
    const row = await db.vaults.get(vault.id);
    expect(JSON.stringify(row)).not.toContain("Hotel");
    expect(JSON.stringify(row)).not.toContain("offline-test-passphrase");
    const name = db.name;
    db.close();
    db = new OfflineDatabase(name);
    vault = await OfflineVault.unlock(db, vault.id, "offline-test-passphrase");
    const after = await vault.read();
    expect(after.operations).toEqual(before.operations);
    expect(
      localStock(after).find((c) => c.stock_kind === "FULL_JAR")?.quantity,
    ).toBe(65);
    expect(customerEstimate(after, customer, jar).estimated).toBe(5);
  });
  it("rejects incorrect paid amounts and excessive stock with no local effects", async () => {
    await expect(
      vault.record("DELIVERY", { ...sale(), received: "349.00" }),
    ).rejects.toThrow(/equal/);
    await expect(vault.record("DELIVERY", sale(101, 0))).rejects.toThrow(
      /remaining stock/,
    );
    expect((await vault.read()).operations).toHaveLength(0);
  });
  it("serializes two concurrent tabs and prevents negative local inventory", async () => {
    const other = await OfflineVault.unlock(
      db,
      vault.id,
      "offline-test-passphrase",
    );
    const results = await Promise.allSettled([
      vault.record("DELIVERY", sale(70, 0)),
      other.record("DELIVERY", sale(70, 0)),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(
      localStock(await vault.read()).find((c) => c.stock_kind === "FULL_JAR")
        ?.quantity,
    ).toBe(30);
  });
  it("does not accept a record when the IndexedDB transaction aborts", async () => {
    const original = db.vaults.put.bind(db.vaults);
    db.vaults.put = () => {
      throw new DOMException("Full", "QuotaExceededError");
    };
    await expect(vault.record("DELIVERY", sale())).rejects.toThrow();
    db.vaults.put = original;
    expect((await vault.read()).operations).toHaveLength(0);
  });
  it("keeps ciphertext unreadable with an incorrect passphrase and survives reopening", async () => {
    await vault.record("DELIVERY", sale());
    await expect(
      OfflineVault.unlock(db, vault.id, "incorrect-password"),
    ).rejects.toThrow(/unlock/);
    const name = db.name;
    db.close();
    db = new OfflineDatabase(name);
    await expect(
      (
        await OfflineVault.unlock(db, vault.id, "offline-test-passphrase")
      ).read(),
    ).resolves.toHaveProperty("operations");
  });
  it("seals the latest local manifest atomically and retains submitted records", async () => {
    await vault.record("DELIVERY", sale());
    await vault.record("SUBMIT", {
      counts: localStock(await vault.read()),
      manifest: [],
    });
    const s = await vault.read();
    expect(s.sealed).toBe(true);
    expect(JSON.parse(s.operations[1]!.payload).manifest).toHaveLength(1);
    await expect(vault.record("DELIVERY", sale())).rejects.toThrow(/sealed/);
  });
  it("verifies acknowledgment contents before changing local synchronization status", async () => {
    await vault.record("DELIVERY", sale());
    const op = (await vault.read()).operations[0]!;
    await expect(
      vault.acknowledge(op, {
        id: op.id,
        trip,
        sequence: 1,
        fingerprint: "b".repeat(64),
        status: "CONFIRMED",
        result: crypto.randomUUID(),
        message: null,
        processedAt: new Date().toISOString(),
      }),
    ).rejects.toThrow(/match/);
    expect((await vault.read()).operations[0]!.status).toBe("PENDING");
  });
  it("recovers a server commit with lost response by querying the same operation ID", async () => {
    await vault.record("DELIVERY", sale());
    const op = (await vault.read()).operations[0]!,
      receipt: Receipt = {
        id: op.id,
        trip,
        sequence: op.sequence,
        fingerprint: op.fingerprint,
        status: "CONFIRMED",
        result: crypto.randomUUID(),
        message: null,
        processedAt: new Date().toISOString(),
      };
    let posts = 0,
      committed = false;
    const request = async <T>(body?: Record<string, unknown>): Promise<T> => {
      if (!body) return { profile: { id: user } } as T;
      if (body.action === "checkin")
        return {
          round: snapshot().round,
          receipts: committed ? [receipt] : [],
        } as T;
      if (body.action === "post") {
        posts++;
        committed = true;
        throw new SyncError("TEMPORARY", "Response lost");
      }
      if (body.action === "snapshot") {
        const snap = snapshot();
        snap.receipts = committed ? [receipt] : [];
        snap.round.confirmed_sequence = committed ? 1 : 0;
        snap.workspace.balances[0]!.quantity = 65;
        snap.workspace.balances[1]!.quantity = 30;
        return snap as T;
      }
      throw new Error("Unexpected request");
    };
    const controller = new SyncController(
      vault,
      () => {},
      () => {},
      request,
    );
    await controller.run();
    expect((await vault.read()).operations[0]!.status).toBe("PENDING");
    await controller.run(true);
    expect(posts).toBe(1);
    expect((await vault.read()).operations[0]!.status).toBe("SYNCED");
    expect(
      localStock(await vault.read()).find((c) => c.stock_kind === "FULL_JAR")
        ?.quantity,
    ).toBe(65);
  });
  it("creates stable payload fingerprints and keeps customer-before-sale order", async () => {
    expect(canonical({ b: 1, a: 2 })).toBe(canonical({ a: 2, b: 1 }));
    expect(await fingerprint(canonical({ b: 1, a: 2 }))).toBe(
      await fingerprint(canonical({ a: 2, b: 1 })),
    );
    const id = crypto.randomUUID();
    await vault.record("CUSTOMER", {
      id,
      name: "New hotel",
      shop_name: "",
      phone: "98123",
      address: "",
      version: 0,
    });
    await vault.record("DELIVERY", {
      ...sale(),
      customer: id,
      status: "CREDIT",
      received: null,
    });
    const s = await vault.read();
    expect(s.operations.map((o) => o.kind)).toEqual(["CUSTOMER", "DELIVERY"]);
    expect(JSON.parse(s.operations[1]!.payload).customer).toBe(id);
  });
});
