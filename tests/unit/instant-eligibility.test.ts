import { expect, it } from "vitest";
import {
  eligibleInstantTrips,
  instantJarStatus,
  instantPaymentStatus,
} from "@/domain/instant";
import {
  emptyWorkspace,
  type Trip,
  type Workspace,
} from "@/domain/operations/types";
const trip = {
  id: "one",
  driver_id: "driver",
  business_day_id: "open",
  status: "ACTIVE",
} as Trip;
const w = {
  ...emptyWorkspace,
  days: [{ id: "open", status: "OPEN", date_label: "2026-10-14" }],
  trips: [trip],
  loads: [
    {
      trip_id: "one",
      quantity: 100,
      product_id: "jar",
      stock_kind: "FULL_JAR",
    },
  ],
} as Workspace;
it("requires an assigned active trip, open posting day and positive confirmed allocation", () => {
  expect(eligibleInstantTrips(w, "driver")).toEqual([trip]);
  expect(eligibleInstantTrips(w, "different")).toEqual([]);
  expect(eligibleInstantTrips({ ...w, loads: [] })).toEqual([]);
  expect(
    eligibleInstantTrips({ ...w, loads: [{ ...w.loads[0]!, quantity: 0 }] }),
  ).toEqual([]);
  expect(eligibleInstantTrips({ ...w, days: [] })).toEqual([]);
  expect(
    eligibleInstantTrips({
      ...w,
      trips: [{ ...trip, carryover_pending: true }],
    }),
  ).toEqual([]);
});
it.each([
  "DRAFT",
  "LOADED",
  "SUBMITTED",
  "UNDER_REVIEW",
  "DISCREPANCY",
  "CLOSED",
] as const)(
  "does not mistake %s for an active Instant Delivery trip",
  (status) => {
    expect(
      eligibleInstantTrips({ ...w, trips: [{ ...trip, status }] }),
    ).toEqual([]);
  },
);
it("keeps jar and payment settlement independent", () => {
  expect(instantJarStatus({ pending: 5 })).toBe("Pending Return");
  expect(instantPaymentStatus({ outstanding: "0.00" })).toBe("Paid");
  expect(instantJarStatus({ pending: 0 })).toBe("All Returned");
  expect(instantPaymentStatus({ outstanding: "200.00" })).toBe(
    "Credit Outstanding",
  );
  expect(
    instantJarStatus({
      pending: 0,
      returned: 15,
      items: [{ full_jars: 20 }],
    }),
  ).toBe("Resolved by Adjustment");
});
