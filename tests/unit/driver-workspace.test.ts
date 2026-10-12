import { it, expect } from "vitest";
import {
  currentRound,
  roundFinance,
  roundStock,
  roundLabel,
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
