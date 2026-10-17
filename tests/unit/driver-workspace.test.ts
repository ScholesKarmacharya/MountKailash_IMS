import { it, expect } from "vitest";
import {
  currentRound,
  roundFinance,
  roundStock,
  roundLabel,
  tripDayOpen,
  tripCanStart,
} from "@/domain/operations/driver-workspace";
import { pendingDays } from "@/domain/operations/pending-age";
import {
  emptyWorkspace,
  type Trip,
  type Workspace,
} from "@/domain/operations/types";
import { emptyFinance, type FinanceWorkspace } from "@/domain/finance/types";
const trip = {
  id: "round",
  vehicle_id: "vehicle",
  status: "ACTIVE",
  created_at: "2026-10-12",
} as Trip;
it("a prepared trip uses the current open day without starting before its scheduled date", () => {
  const prepared = {
    ...trip,
    status: "LOADED",
    business_day_id: "closed-yesterday",
    scheduled_date: "2026-10-15",
    date_label: "2026-10-15",
  } as Trip;
  const w = {
    ...emptyWorkspace,
    days: [{ id: "today", date_label: "2026-10-14", status: "OPEN" }],
  };
  expect(tripDayOpen(w, prepared)).toBe(true);
  expect(tripCanStart(w, prepared)).toBe(false);
  w.days[0]!.date_label = "2026-10-15";
  expect(tripCanStart(w, prepared)).toBe(true);
  expect(
    tripDayOpen(w, {
      ...prepared,
      status: "ACTIVE",
      business_day_id: "today",
      carryover_pending: true,
    }),
  ).toBe(false);
  expect(tripDayOpen(w, { ...prepared, status: "ACTIVE" })).toBe(false);
});
it("100 loaded, 35 sold and 30 empties remains 65 full with independent jar states", () => {
  const w = {
    ...emptyWorkspace,
    loads: [
      {
        trip_id: trip.id,
        product_id: "jar",
        stock_kind: "FULL_JAR",
        quantity: 100,
      },
    ],
    vehicles: [{ id: "vehicle", location_id: "vehicle-stock" }],
    balances: [
      {
        location_id: "vehicle-stock",
        product_id: "jar",
        stock_kind: "FULL_JAR",
        quantity: 65,
      },
      {
        location_id: "vehicle-stock",
        product_id: "jar",
        stock_kind: "EMPTY_JAR",
        quantity: 30,
      },
    ],
    visits: [
      { id: "visit", customer_id: "customer" },
      { id: "return", customer_id: "customer" },
    ],
    items: [
      { visit_id: "visit", full_jars: 35, empty_jars: 30, cartons: 0 },
      { visit_id: "return", full_jars: 0, empty_jars: 0, cartons: 0 },
    ],
  } as Workspace;
  expect(roundStock(w, trip)).toMatchObject({
    loadedFull: 100,
    soldFull: 35,
    remainingFull: 65,
    collectedEmpty: 30,
    visits: 2,
    deliveries: 1,
    customers: 1,
  });
  const closed = { ...trip, status: "CLOSED" } as Trip;
  w.balances[0]!.quantity = 80; // Same vehicle's next round must not rewrite old stock.
  w.movements = [
    { movement_type: "TRIP_RETURN", stock_kind: "FULL_JAR", quantity: 65 },
  ] as Workspace["movements"];
  expect(roundStock(w, closed)).toMatchObject({
    remainingFull: 0,
    loadedFull: 100,
    returnedFull: 65,
  });
});
it("chooses the operational round, preserves internal statuses and maps return review simply", () => {
  expect(
    currentRound({
      ...emptyWorkspace,
      trips: [
        { ...trip, id: "draft", status: "DRAFT" },
        trip,
        { ...trip, id: "old", status: "CLOSED" },
      ],
    }),
  ).toEqual(trip);
  expect(roundLabel("DISCREPANCY")).toBe("Returned / Awaiting Confirmation");
  expect(
    currentRound({ ...emptyWorkspace, trips: [{ ...trip, status: "CLOSED" }] }),
  ).toBeUndefined();
});
it("excludes cancelled and completed trips and prioritizes actionable trips before returned status", () => {
  const cancelled = {
    ...trip,
    id: "cancelled",
    status: "LOADED",
    cancelled: true,
  } as Trip;
  const returned = { ...trip, id: "returned", status: "SUBMITTED" } as Trip;
  const draft = {
    ...trip,
    id: "draft",
    status: "DRAFT",
    scheduled_date: "2026-10-17",
  } as Trip;
  const loaded = { ...draft, id: "loaded", status: "LOADED" } as Trip;
  const w = { ...emptyWorkspace, trips: [cancelled, returned, draft, loaded] };
  expect(currentRound(w)?.id).toBe("loaded");
  expect(currentRound({ ...w, trips: [returned, draft] })?.id).toBe("draft");
  expect(currentRound({ ...w, trips: [cancelled] })).toBeUndefined();
  expect(
    tripDayOpen(
      { ...w, days: [{ id: "day", status: "OPEN", date_label: "2026-10-17" }] },
      cancelled,
    ),
  ).toBe(false);
  expect(
    tripCanStart(
      { ...w, days: [{ id: "day", status: "OPEN", date_label: "2026-10-17" }] },
      cancelled,
    ),
  ).toBe(false);
});
it("breaks multiple-trip anomalies deterministically by status, earliest schedule, newest creation and sequence", () => {
  const loaded = {
    ...trip,
    status: "LOADED",
    scheduled_date: "2026-10-18",
    created_at: "2026-10-16",
  } as Trip;
  const due = {
    ...loaded,
    id: "due",
    scheduled_date: "2026-10-17",
    trip_number: 9,
  };
  const newest = { ...due, id: "newest", created_at: "2026-10-17" };
  const w = { ...emptyWorkspace, trips: [loaded, due, newest] };
  expect(currentRound(w)?.id).toBe("newest");
  expect(currentRound({ ...w, trips: [...w.trips].reverse() })?.id).toBe(
    "newest",
  );
  expect(currentRound({ ...w, trips: [...w.trips, trip] })?.id).toBe(trip.id);
});
it("old-credit collections, pending Fonepay and corrections stay separate from new sales", () => {
  const f = {
    ...emptyFinance,
    available: true,
    sales: [{ id: "sale", trip_id: trip.id, business_day_id: "old" }],
    invoices: [{ id: "invoice", sale_id: "sale" }],
    adjustments: [{ id: "adjustment", invoice_id: "invoice" }],
    payments: [
      {
        id: "cash",
        trip_id: trip.id,
        method: "CASH",
        business_day_id: "today",
        status: "CONFIRMED",
        amount: "50.25",
      },
      {
        id: "fp",
        trip_id: trip.id,
        method: "FONEPAY",
        business_day_id: "today",
        status: "PENDING",
        amount: "10.50",
      },
    ],
    issued: [{ invoice_id: "invoice", amount: "100.00" }],
    journal: [
      {
        account: "SALES",
        source_id: "invoice",
        amount: "-100.00",
        business_day_id: "old",
      },
      {
        account: "SALES",
        source_id: "adjustment",
        amount: "5.00",
        business_day_id: "today",
      },
      {
        account: "CASH",
        source_id: "cash",
        amount: "50.25",
        business_day_id: "today",
      },
    ],
  } as FinanceWorkspace;
  expect(roundFinance(f, trip.id, "today")).toMatchObject({
    sales: "-5.00",
    cash: "50.25",
    fonepayPending: "10.50",
    fonepayVerified: "0.00",
    creditIssued: "0.00",
  });
  expect(roundFinance(f, trip.id).sales).toBe("95.00");
  expect(roundFinance(f, undefined, "next-day")).toMatchObject({
    sales: "0.00",
    cash: "0.00",
    creditIssued: "0.00",
  });
});
it("pending age uses Nepal calendar dates and never mutates the original date", () => {
  const original = "2026-10-11T18:14:59Z";
  expect(pendingDays(original, new Date("2026-10-11T18:15:01Z"))).toBe(1);
  expect(pendingDays(original, new Date("2026-10-11T18:14:59Z"))).toBe(0);
});
it("driver totals use authorized invoice and payment events when the accounting journal is withheld", () => {
  const f = {
    ...emptyFinance,
    available: true,
    sales: [{ id: "sale", trip_id: trip.id, business_day_id: "old" }],
    invoices: [{ id: "invoice", sale_id: "sale", total: "100.00" }],
    adjustments: [
      {
        id: "adjustment",
        invoice_id: "invoice",
        subtotal_delta: "-5.00",
        tax_delta: "0.00",
        business_day_id: "today",
      },
    ],
    payments: [
      {
        id: "cash",
        trip_id: trip.id,
        method: "CASH",
        business_day_id: "today",
        status: "CONFIRMED",
        amount: "50.25",
      },
      {
        id: "fp",
        trip_id: trip.id,
        method: "FONEPAY",
        business_day_id: "old",
        status: "REVERSED",
        amount: "10.50",
      },
    ],
    events: [
      {
        payment_id: "cash",
        sequence: 3,
        status: "CONFIRMED",
        business_day_id: "today",
      },
      {
        payment_id: "fp",
        sequence: 1,
        status: "PENDING",
        business_day_id: "old",
      },
      {
        payment_id: "fp",
        sequence: 2,
        status: "CONFIRMED",
        business_day_id: "old",
      },
      {
        payment_id: "fp",
        sequence: 4,
        status: "REVERSED",
        business_day_id: "today",
      },
    ],
  } as FinanceWorkspace;
  expect(roundFinance(f, trip.id, "today")).toMatchObject({
    sales: "-5.00",
    cash: "50.25",
    fonepayVerified: "-10.50",
  });
  expect(roundFinance(f, trip.id, "old")).toMatchObject({
    sales: "100.00",
    cash: "0.00",
    fonepayVerified: "10.50",
  });
  expect(roundFinance(f, trip.id)).toMatchObject({
    sales: "95.00",
    cash: "50.25",
    fonepayVerified: "0.00",
  });
  expect(roundFinance(f, "different-trip")).toMatchObject({
    sales: "0.00",
    cash: "0.00",
    fonepayVerified: "0.00",
  });
});
