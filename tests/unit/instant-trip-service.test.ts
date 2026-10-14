import { beforeEach, expect, it, vi } from "vitest";
import { emptyWorkspace, type Trip } from "@/domain/operations/types";
import { emptyFinance } from "@/domain/finance/types";
const mocks = vi.hoisted(() => ({ operations: vi.fn(), finance: vi.fn() }));
vi.mock("@/services/operations", () => ({ getOperations: mocks.operations }));
vi.mock("@/services/finance", () => ({ getFinance: mocks.finance }));
import { getDriverWorkspace } from "@/services/driver-workspace";
const one = "10000000-0000-4000-8000-000000000001",
  two = "10000000-0000-4000-8000-000000000002";
const trip = (id: string) =>
  ({
    id,
    driver_id: "driver",
    status: "ACTIVE",
    business_day_id: "day",
    created_at: "2026-10-14",
  }) as Trip;
const base = {
  ...emptyWorkspace,
  days: [{ id: "day", status: "OPEN", date_label: "2026-10-14" }],
  trips: [trip(one)],
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.finance.mockResolvedValue(emptyFinance);
  mocks.operations.mockImplementation(async (_admin, id) =>
    id
      ? {
          ...base,
          trips: [trip(id)],
          loads: [
            {
              trip_id: id,
              quantity: 100,
              stock_kind: "FULL_JAR",
              product_id: "jar",
            },
          ],
        }
      : base,
  );
});
it("checks scoped stock rather than incorrectly reading empty overview allocations", async () => {
  const result = await getDriverWorkspace();
  expect(result.eligibleTrips.map((t) => t.id)).toEqual([one]);
  expect(result.delivering).toBe(true);
  expect(result.tripChoiceRequired).toBe(false);
  expect(mocks.operations).toHaveBeenCalledWith(false, one);
});
it("defensively requires a choice if more than one eligible trip is returned", async () => {
  mocks.operations.mockImplementation(async (_admin, id) =>
    id
      ? { ...base, trips: [trip(id)], loads: [{ trip_id: id, quantity: 100 }] }
      : { ...base, trips: [trip(one), trip(two)] },
  );
  expect((await getDriverWorkspace()).tripChoiceRequired).toBe(true);
  const chosen = await getDriverWorkspace(two);
  expect(chosen.trip?.id).toBe(two);
  expect(chosen.tripChoiceRequired).toBe(false);
  await expect(
    getDriverWorkspace("10000000-0000-4000-8000-000000000003"),
  ).rejects.toThrow("authorized active");
});
it("does not offer a form for an active trip without confirmed allocations", async () => {
  mocks.operations.mockResolvedValue(base);
  expect((await getDriverWorkspace()).eligibleTrips).toEqual([]);
});
