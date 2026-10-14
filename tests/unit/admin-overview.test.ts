import { expect, it } from "vitest";
import {
  overviewActivity,
  overviewFinance,
  overviewRoundStock,
  overviewTripGroups,
} from "@/domain/operations/admin-overview";
import {
  emptyWorkspace,
  type Trip,
  type Workspace,
} from "@/domain/operations/types";
import { emptyFinance } from "@/domain/finance/types";
import { financeMetrics } from "@/domain/finance/reports";
import type { DayDetail, DayReport } from "@/domain/business-days/types";
import { dictionaries } from "@/lib/i18n/messages";

const day = { id: "today", date_label: "2026-10-14" };
const trip = (id: string, status: Trip["status"], extra: Partial<Trip> = {}) =>
  ({
    id,
    status,
    business_day_id: day.id,
    date_label: day.date_label,
    scheduled_date: day.date_label,
    driver_name: "Driver 123",
    plate_number: "2102",
    vehicle_id: "vehicle",
    ...extra,
  }) as Trip;
const report = (extra: Partial<DayReport> = {}) =>
  ({
    day,
    trips: [],
    totals: { completed_trips: 0 },
    prepared_trips: [],
    customers: [],
    processing: [],
    movements: [],
    journal: [],
    payments: [],
    events: [],
    ...extra,
  }) as DayReport;

it("distinguishes active, returned, prepared, scheduled and cancelled trips without changing their statuses", () => {
  const workspace = {
    ...emptyWorkspace,
    trips: [
      trip("active", "ACTIVE"),
      ...(["SUBMITTED", "UNDER_REVIEW", "DISCREPANCY"] as const).map((s) =>
        trip(s, s),
      ),
      trip("ready", "LOADED"),
      trip("completed", "CLOSED"),
      trip("future", "LOADED", { scheduled_date: "2026-10-15" }),
      trip("future-draft", "DRAFT", { scheduled_date: "2026-10-15" }),
      trip("cancelled", "CLOSED", { cancelled: true }),
    ],
  };
  const before = structuredClone(workspace);
  expect(overviewTripGroups(workspace, day)).toMatchObject({
    active: 1,
    awaiting: 3,
    prepared: 1,
    completed: 1,
    ready: 1,
  });
  expect(overviewTripGroups(workspace, day).scheduled.map((t) => t.id)).toEqual(
    ["future-draft"],
  );
  expect(workspace).toEqual(before);
});

it("uses backend posting-period membership for a carried trip from an earlier day", () => {
  const carried = trip("carried", "ACTIVE", {
    business_day_id: "yesterday",
    date_label: "2026-10-13",
    scheduled_date: "2026-10-13",
  });
  const workspace = { ...emptyWorkspace, trips: [carried] };
  const groups = overviewTripGroups(
    workspace,
    day,
    report({ trips: [{ id: carried.id }] as DayReport["trips"] }),
  );
  expect(groups.today).toEqual([carried]);
  expect(groups.active).toBe(1);
});

it("keeps confirmed future loads visible after the loading day closes", () => {
  const prepared = trip("future", "LOADED", { scheduled_date: "2026-10-15" });
  const groups = overviewTripGroups(
    { ...emptyWorkspace, trips: [prepared] },
    null,
    undefined,
    "2026-10-14",
  );
  expect(groups.future).toEqual([prepared]);
  expect(groups.prepared).toBe(1);
  expect(groups.today).toEqual([]);
});

it("copies all nine authoritative financial figures without combining deposits, revenue or reconciliation", () => {
  const totals = {
    sales: "100.25",
    collections: "250.50",
    new_credit: "50.00",
    outstanding: "750.00",
    cash: "200.00",
    pending_fonepay: "25.00",
    fonepay: "50.50",
    old_credit_recovered: "80.00",
    deposit_liability: "20.00",
  };
  const detail = {
    report: report({ totals: totals as DayReport["totals"] }),
  } as DayDetail;
  expect(overviewFinance(detail, emptyFinance, day.id)).toEqual({
    available: true,
    sales: totals.sales,
    collections: totals.collections,
    issued: totals.new_credit,
    outstanding: totals.outstanding,
    cash: totals.cash,
    pending: totals.pending_fonepay,
    fonepay: totals.fonepay,
    recovered: totals.old_credit_recovered,
    deposits: totals.deposit_liability,
  });
  expect(overviewFinance(null, emptyFinance, day.id)).toEqual({
    ...financeMetrics(emptyFinance, day.id),
    available: false,
  });
});

it("separates HOUSE free jars from sold jars while keeping the physical stock and visits intact", () => {
  const current = trip("current", "ACTIVE");
  const workspace = {
    ...emptyWorkspace,
    vehicles: [{ id: "vehicle", location_id: "on-vehicle" }],
    loads: [
      {
        trip_id: "current",
        product_id: "jar",
        stock_kind: "FULL_JAR",
        quantity: 100,
      },
    ],
    balances: [
      {
        product_id: "jar",
        stock_kind: "FULL_JAR",
        quantity: 65,
        location_id: "on-vehicle",
      },
    ],
    items: [
      {
        full_jars: 30,
        empty_jars: 20,
        cartons: 0,
        supply_classification: "SALE",
      },
      {
        full_jars: 5,
        empty_jars: 3,
        cartons: 0,
        supply_classification: "FREE_SUPPLY",
      },
    ],
  } as Workspace;
  const before = structuredClone(workspace);
  expect(overviewRoundStock(workspace, current)).toMatchObject({
    loadedFull: 100,
    soldFull: 30,
    freeFull: 5,
    remainingFull: 65,
    collectedEmpty: 23,
  });
  expect(workspace).toEqual(before);
});

it.each([
  "TRIP_LOAD",
  "TRIP_RETURN",
  "TRIP_UNLOAD",
  "DELIVERY",
  "EMPTY_COLLECTION",
  "REFILL_INPUT",
  "REFILL_OUTPUT",
  "WAREHOUSE_DAMAGE",
  "MANUAL_INCREASE",
  "MANUAL_DECREASE",
  "VARIANCE_GAIN",
  "VARIANCE_LOSS",
  "FUTURE_MOVEMENT",
])(
  "provides a bilingual activity description for %s without altering the audit row",
  (type) => {
    const original = report({
      movements: [
        {
          id: "movement",
          movement_type: type,
          quantity: 8,
          stock_kind: "FULL_JAR",
          trip_id: "trip",
          visit_id: "visit",
          created_at: "2026-10-14T12:00:00Z",
        },
      ],
      customers: [
        { id: "visit", name: "ABC Hotel 123" },
      ] as DayReport["customers"],
    });
    const before = structuredClone(original);
    const row = overviewActivity(original, {
      ...emptyWorkspace,
      trips: [trip("trip", "ACTIVE")],
    })[0]!;
    expect(dictionaries.en[row.key]).toBeDefined();
    expect(dictionaries.ne[row.key]).toBeDefined();
    expect(row.values).toContain(8);
    expect(row.context).toContain("Driver 123");
    expect(row.href).toBe("/admin/trips/trip");
    expect(original).toEqual(before);
  },
);

it("shows a completed refill once and never treats an isolated input as a completed refill", () => {
  const movement = {
    quantity: 10,
    processing_id: "refill",
    stock_kind: "EMPTY_JAR",
    created_at: "2026-10-14T12:00:00Z",
  };
  const input = { ...movement, id: "input", movement_type: "REFILL_INPUT" };
  const output = {
    ...movement,
    id: "output",
    movement_type: "REFILL_OUTPUT",
    stock_kind: "FULL_JAR",
  };
  expect(
    overviewActivity(report({ movements: [input, output] }), emptyWorkspace),
  ).toHaveLength(1);
  expect(
    overviewActivity(report({ movements: [input] }), emptyWorkspace)[0]!.key,
  ).toBe("{0} empty jars sent for refilling");
});

it("displays posted sales with the journal's revenue sign reversed and keeps receipt signs", () => {
  const rows = overviewActivity(
    report({
      journal: [
        {
          id: "sale",
          source_id: "invoice",
          account: "SALES",
          kind: "INVOICE",
          amount: "-150.25",
          created_at: "2026-10-14T12:00:00Z",
        },
        {
          id: "reverse",
          source_id: "payment",
          account: "CASH",
          kind: "REVERSAL",
          amount: "-50.25",
          created_at: "2026-10-14T12:00:01Z",
        },
      ],
    }),
    emptyWorkspace,
  );
  expect(rows.find((r) => r.id === "sale")?.values).toEqual(["NPR 150.25"]);
  expect(rows.find((r) => r.id === "reverse")?.values).toEqual(["NPR -50.25"]);
});
