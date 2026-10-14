import { expect, it } from "vitest";
import { emptyWorkspace, type Workspace } from "@/domain/operations/types";
import { emptyFinance } from "@/domain/finance/types";
import type { LocalState, DeliveryDraft } from "@/domain/offline/types";
import type { PendingJar } from "@/domain/operations/pending-jars";
import type { DeliveryCustomerContext } from "@/domain/operations/customer-context";
import {
  driverJarCustomers,
  filterDriverJars,
  driverJarSummary,
  driverJarActivities,
  type DriverJarFilters,
} from "@/domain/operations/driver-jars";
import { customerEstimate } from "@/domain/offline/operations";
import { projectedWorkspace } from "@/domain/offline/projection";

const customer = {
  id: "customer",
  name: "ABC Hotel",
  phone: "9801234567",
  address: "Kathmandu",
  notes: "",
  shop_name: "",
  version: 1,
  is_active: true,
  supply_type: "HOUSE" as const,
};
const product = {
  id: "jar",
  name: "20L",
  sku: "JAR",
  kind: "FULL_JAR" as const,
  unit: "jar",
  default_price: "10.00",
  version: 1,
  is_active: true,
};
const lot = (
  id = "opening",
  qty = 10,
  date = "2026-10-01T00:00:00Z",
): PendingJar => ({
  entry_id: id,
  customer_id: customer.id,
  customer_name: customer.name,
  product_id: product.id,
  product_name: product.name,
  original_date: date,
  business_date: date.slice(0, 10),
  quantity: qty,
  pending: qty,
  source: "Delivery",
  trip_number: 1,
});
const workspace = (): Workspace => ({
  ...structuredClone(emptyWorkspace),
  available: true,
  customers: [customer],
  products: [product],
  custody: [{ customer_id: customer.id, product_id: product.id, quantity: 10 }],
  trips: [
    {
      id: "trip",
      trip_number: 1,
      driver_id: "driver",
      driver_name: "Driver",
      vehicle_id: "vehicle",
      plate_number: "TEST",
      business_day_id: "day",
      date_label: "2026-10-14",
      status: "ACTIVE",
      notes: "",
      created_at: "2026-10-14T00:00:00Z",
      close_reason: "",
    },
  ],
  vehicles: [
    {
      id: "vehicle",
      location_id: "vehicle-location",
      plate_number: "TEST",
      description: "",
      version: 1,
      is_active: true,
    },
  ],
});
const context = (): DeliveryCustomerContext => ({
  customer,
  billing: null,
  prices: [],
  credit: [],
  credit_history: [],
  custody_history: [],
  custody: [{ customer_id: customer.id, product_id: product.id, quantity: 10 }],
  pending_jars: [lot()],
  jar_allocations: [],
});
function state(): LocalState {
  return {
    version: 1,
    user: "driver",
    device: "device",
    token: "token",
    locale: "en",
    sealed: false,
    operations: [],
    recovery: [],
    snapshot: {
      profile: {
        id: "driver",
        name: "Driver",
        role: "DRIVER",
        is_active: true,
        approval_status: "APPROVED",
      },
      round: {
        trip_id: "trip",
        driver_id: "driver",
        device_id: "device",
        phase: "ACTIVE",
        confirmed_sequence: 0,
        registered_at: "2026-10-14T00:00:00Z",
        last_seen_at: "2026-10-14T00:00:00Z",
        reported_pending: 0,
        checkpoint_at: null,
      },
      workspace: workspace(),
      finance: structuredClone(emptyFinance),
      contexts: [context()],
      locale: "en",
      receipts: [],
      fetchedAt: "2026-10-14T00:00:00Z",
      authorizedUntil: "2026-10-20T00:00:00Z",
    },
  };
}
function add(
  s: LocalState,
  full: number,
  empty: number,
  id = `op-${s.operations.length}`,
) {
  const draft: DeliveryDraft = {
    customer: customer.id,
    walk_name: "",
    walk_phone: "",
    items: [
      {
        product_id: product.id,
        full_jars: full,
        empty_jars: empty,
        cartons: 0,
      },
    ],
    status: full ? "CREDIT" : "RETURN_ONLY",
    total: `${full * 10}.00`,
    received: null,
    prices: [{ product_id: product.id, price: "10.00" }],
    custody: [],
    notes: "",
  };
  s.operations.push({
    version: 1,
    id,
    trip: "trip",
    sequence: s.operations.length + 1,
    kind: "DELIVERY",
    occurredAt: `2026-10-${14 + s.operations.length}T00:00:00Z`,
    payload: JSON.stringify(draft),
    fingerprint: "fingerprint",
    status: "PENDING",
    attempts: 0,
    retryAt: 0,
  });
}
const filters: DriverJarFilters = {
  search: "",
  from: "",
  to: "",
  sort: "highest",
};
it("groups confirmed FIFO rows into one unchanged customer quantity", () => {
  const w = workspace(),
    pending = {
      available: true,
      rows: [lot("old", 5), lot("new", 8, "2026-10-14T00:00:00Z")],
    };
  const before = structuredClone(pending);
  const rows = driverJarCustomers(w, pending);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    pending: 13,
    confirmed: 13,
    status: "confirmed",
    oldest: "2026-10-01T00:00:00Z",
  });
  expect(rows[0]!.customer.supply_type).toBe("HOUSE");
  expect(pending).toEqual(before);
});
it("preserves the existing offline estimates and FIFO dates across 10 → 13 → 8 → 5", () => {
  const s = state();
  for (const [full, empty, expected] of [
    [8, 5, 13],
    [5, 10, 8],
    [0, 3, 5],
  ]) {
    add(s, full!, empty!);
    const before = structuredClone(s);
    const row = driverJarCustomers(projectedWorkspace(s), undefined, s)[0]!;
    expect(row.pending).toBe(expected);
    expect(row.pending).toBe(
      customerEstimate(s, customer.id, product.id).estimated,
    );
    expect(row.lots.reduce((n, l) => n + l.quantity, 0)).toBe(expected);
    expect(s).toEqual(before);
  }
  const row = driverJarCustomers(projectedWorkspace(s), undefined, s)[0]!;
  expect(row.oldest).toBe(s.operations[1]!.occurredAt);
  expect(
    driverJarActivities(
      s.snapshot.contexts[0],
      s.snapshot.workspace,
      s,
      customer.id,
    ).map((a) => a.balance),
  ).toEqual([5, 8, 13]);
});
it("does not add acknowledged deliveries twice after snapshot synchronization", () => {
  const s = state();
  add(s, 8, 5);
  s.snapshot.receipts.push({
    id: s.operations[0]!.id,
    trip: "trip",
    sequence: 1,
    fingerprint: "fingerprint",
    status: "CONFIRMED",
    result: "visit",
    message: null,
    processedAt: "2026-10-14T01:00:00Z",
  });
  s.snapshot.contexts[0]!.custody[0]!.quantity = 13;
  s.snapshot.contexts[0]!.pending_jars = [
    lot("old", 5),
    lot("new", 8, "2026-10-14T00:00:00Z"),
  ];
  const row = driverJarCustomers(projectedWorkspace(s), undefined, s)[0]!;
  expect(row).toMatchObject({
    pending: 13,
    confirmed: 13,
    deviceChange: 0,
    status: "confirmed",
  });
  expect(row.lots.every((l) => !l.local)).toBe(true);
  expect(
    driverJarActivities(
      s.snapshot.contexts[0],
      s.snapshot.workspace,
      s,
      customer.id,
    ),
  ).toHaveLength(0);
});
it("filters customers by BS-compatible delivery dates without reducing their total balance", () => {
  const rows = driverJarCustomers(workspace(), {
    available: true,
    rows: [lot("old", 5), lot("new", 8, "2026-10-14T00:00:00Z")],
  });
  const shown = filterDriverJars(rows, {
    ...filters,
    search: " 1234567 ",
    from: "2026-10-14",
    to: "2026-10-14",
  });
  expect(shown[0]!.pending).toBe(13);
  expect(shown[0]!.lots).toHaveLength(2);
  expect(filterDriverJars(rows, { ...filters, from: "2026-10-15" })).toEqual(
    [],
  );
});
it("sorts highest quantities, oldest dates and recent activity independently and reports Nepal day ages", () => {
  const first = driverJarCustomers(workspace(), {
    available: true,
    rows: [lot()],
  })[0]!;
  const second = {
    ...first,
    customer: { ...customer, id: "second", name: "Second" },
    pending: 20,
    oldest: "2026-10-10T00:00:00Z",
    lots: [{ ...first.lots[0]!, date: "2026-10-10T00:00:00Z" }],
    lastActivity: "2026-10-13T00:00:00Z",
  };
  const rows = [first, second];
  expect(filterDriverJars(rows, filters)[0]!.customer.id).toBe("second");
  expect(
    filterDriverJars(rows, { ...filters, sort: "oldest" })[0]!.customer.id,
  ).toBe(customer.id);
  expect(
    filterDriverJars(rows, { ...filters, sort: "recent" })[0]!.customer.id,
  ).toBe("second");
  expect(driverJarSummary(rows, new Date("2026-10-14T18:15:00Z"))).toEqual({
    total: 30,
    customers: 2,
    oldestDays: 14,
  });
  expect(driverJarSummary([])).toEqual({
    total: 0,
    customers: 0,
    oldestDays: null,
  });
});
it("retains review status even for a zero net device change and excludes settled customers", () => {
  const s = state();
  add(s, 3, 3);
  s.operations[0]!.status = "NEEDS_REVIEW";
  expect(
    driverJarCustomers(projectedWorkspace(s), undefined, s)[0],
  ).toMatchObject({ pending: 10, deviceChange: 0, status: "review" });
  add(s, 0, 10);
  expect(
    filterDriverJars(
      driverJarCustomers(projectedWorkspace(s), undefined, s),
      filters,
    ),
  ).toEqual([]);
});
it("presents the existing per-product resulting balances and original synchronized occurrence dates", () => {
  const c = context();
  c.custody_history = [
    {
      id: "return",
      product_id: product.id,
      delta: -5,
      resulting_balance: 13,
      reason: "Empty jars collected",
      created_at: "2026-10-14T01:00:00Z",
    },
  ];
  c.jar_allocations = [
    {
      return_entry_id: "return",
      delivery_entry_id: "old",
      product_id: product.id,
      quantity: 5,
      original_date: "2026-10-01T00:00:00Z",
      returned_at: "2026-10-13T01:00:00Z",
      source: "Empty collection",
    },
  ];
  const event = driverJarActivities(c, workspace())[0]!;
  expect(event).toMatchObject({
    returned: 5,
    delivered: 0,
    balance: 13,
    status: "confirmed",
    date: "2026-10-13T01:00:00Z",
  });
});
