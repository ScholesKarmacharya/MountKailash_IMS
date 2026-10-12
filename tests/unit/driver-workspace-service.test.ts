import { beforeEach, it, expect, vi } from "vitest";
import { emptyWorkspace, type Trip } from "@/domain/operations/types";
const { getOperations, getFinance } = vi.hoisted(() => ({
  getOperations: vi.fn(),
  getFinance: vi.fn(),
}));
vi.mock("@/services/operations", () => ({ getOperations }));
vi.mock("@/services/finance", () => ({ getFinance }));
import { getDriverWorkspace } from "@/services/driver-workspace";
const trip = {
  id: "round",
  business_day_id: "day",
  status: "ACTIVE",
  created_at: "2026-10-12T00:00:00Z",
} as Trip;
beforeEach(() => {
  vi.clearAllMocks();
  getFinance.mockResolvedValue({ available: true });
});
it("keeps closing-review totals visible while delivery posting is locked", async () => {
  const workspace = {
    ...emptyWorkspace,
    available: true,
    trips: [trip],
    days: [{ id: "day", date_label: "2026-10-12", status: "CLOSING_REVIEW" }],
  };
  getOperations.mockResolvedValue(workspace);
  const result = await getDriverWorkspace();
  expect(result.day?.id).toBe("day");
  expect(result.delivering).toBe(false);
  expect(result.dayOpen).toBe(false);
  expect(getOperations.mock.calls).toEqual([[false], [false, "round"]]);
  expect(getFinance).toHaveBeenCalledWith(false);
});
it("does not use a closed round as the current vehicle load", async () => {
  getOperations.mockResolvedValue({
    ...emptyWorkspace,
    available: true,
    trips: [{ ...trip, status: "CLOSED" }],
  });
  const result = await getDriverWorkspace();
  expect(result.trip).toBeUndefined();
  expect(result.day).toBeUndefined();
  expect(result.delivering).toBe(false);
  expect(getOperations).toHaveBeenCalledTimes(1);
});
