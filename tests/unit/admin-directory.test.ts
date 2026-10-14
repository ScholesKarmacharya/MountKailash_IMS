import { beforeEach, expect, it, vi } from "vitest";
import { emptyWorkspace, type Trip } from "@/domain/operations/types";
import {
  filterTrips,
  tripLabel,
  tripTone,
} from "@/domain/operations/trip-presentation";
const mocks = vi.hoisted(() => ({
  guard: vi.fn(),
  read: vi.fn(),
  write: vi.fn(),
}));
vi.mock("@/services/auth", () => ({ requirePermission: mocks.guard }));
vi.mock("@/data-access/operations", () => ({
  readOperations: mocks.read,
  writeOperation: mocks.write,
  readCustomerDeliveries: vi.fn(),
  readDeliveryCustomer: vi.fn(),
}));
import { saveOperation } from "@/services/operations";
const trip = {
  id: crypto.randomUUID(),
  vehicle_id: crypto.randomUUID(),
  driver_id: crypto.randomUUID(),
  status: "ACTIVE",
  cancelled: false,
} as Trip;
beforeEach(() => {
  vi.resetAllMocks();
});
it("maps every actual lifecycle and cancellation without changing records", () => {
  const original = { ...trip };
  expect(tripLabel({ ...trip, status: "LOADED" })).toBe("Prepared / Loaded");
  expect(tripLabel({ ...trip, status: "SUBMITTED" })).toBe(
    "Awaiting confirmation",
  );
  expect(tripTone({ ...trip, status: "DISCREPANCY" })).toBe("warning");
  expect(tripLabel({ ...trip, status: "CLOSED", cancelled: true })).toBe(
    "Cancelled",
  );
  expect(trip).toEqual(original);
});
it("filters independent driver, vehicle and status including cancelled closed trips", () => {
  const cancelled = {
    ...trip,
    id: crypto.randomUUID(),
    status: "CLOSED" as const,
    cancelled: true,
  };
  const complete = {
    ...trip,
    id: crypto.randomUUID(),
    status: "CLOSED" as const,
  };
  const records = [trip, cancelled, complete];
  expect(
    filterTrips(records, {
      driver: trip.driver_id,
      vehicle: trip.vehicle_id,
      status: "CLOSED",
    }),
  ).toEqual([complete]);
  expect(filterTrips(records, { status: "CANCELLED" })).toEqual([cancelled]);
  expect(filterTrips(records, { driver: crypto.randomUUID() })).toEqual([]);
  expect(filterTrips(records, {})).toEqual(records);
});
function vehicle(active: boolean) {
  const form = new FormData();
  for (const [key, value] of Object.entries({
    operation: "vehicle",
    id: trip.vehicle_id,
    version: "1",
    key: crypto.randomUUID(),
    plate_number: "TEST-PLATE",
    description: "",
    active: String(active),
    reason: "Inspected by administrator",
  }))
    form.set(key, value);
  return form;
}
it("authorizes before checking vehicle assignments and refuses open-trip deactivation", async () => {
  mocks.read.mockResolvedValue({
    ...emptyWorkspace,
    available: true,
    trips: [trip],
  });
  await expect(saveOperation(vehicle(false))).rejects.toThrow(
    "Complete or cancel",
  );
  expect(mocks.guard).toHaveBeenCalledWith("trip:assign");
  expect(mocks.guard.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.read.mock.invocationCallOrder[0]!,
  );
  expect(mocks.write).not.toHaveBeenCalled();
});
it("fails closed when assignment data cannot be loaded", async () => {
  mocks.read.mockResolvedValue(emptyWorkspace);
  await expect(saveOperation(vehicle(false))).rejects.toThrow(
    "could not be loaded",
  );
  expect(mocks.write).not.toHaveBeenCalled();
});
it("keeps normal edits and deactivation after closure on the same audited RPC", async () => {
  mocks.read.mockResolvedValue({
    ...emptyWorkspace,
    available: true,
    trips: [{ ...trip, status: "CLOSED" }],
  });
  mocks.write.mockResolvedValue(trip.vehicle_id);
  await expect(saveOperation(vehicle(false))).resolves.toBe(trip.vehicle_id);
  expect(mocks.write).toHaveBeenCalledWith(
    expect.objectContaining({
      rpc: "save_vehicle",
      args: expect.objectContaining({ p_id: trip.vehicle_id, p_active: false }),
    }),
  );
  await saveOperation(vehicle(true));
  expect(mocks.read).toHaveBeenCalledTimes(1);
});
