import { it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
const mocks = vi.hoisted(() => ({
  requirePermission: vi.fn(),
  writeOperation: vi.fn(),
  readFinance: vi.fn(),
}));
vi.mock("@/services/auth", () => ({
  requirePermission: mocks.requirePermission,
}));
vi.mock("@/data-access/operations", () => ({
  writeOperation: mocks.writeOperation,
}));
vi.mock("@/data-access/finance", () => ({ readFinance: mocks.readFinance }));
import { saveFinance, getFinance } from "@/services/finance";
beforeEach(() => vi.resetAllMocks());
it("denied server permission prevents admin mutation reaching Supabase", async () => {
  const f = new FormData();
  Object.entries({
    operation: "finance:REFUND",
    key: randomUUID(),
    customer: randomUUID(),
    day: randomUUID(),
    amount: "1",
    reason: "Explicit refund",
  }).forEach(([k, v]) => f.set(k, v));
  mocks.requirePermission.mockRejectedValue(new Error("Denied"));
  await expect(saveFinance(f)).rejects.toThrow("Denied");
  expect(mocks.requirePermission).toHaveBeenCalledWith("finance:manage");
  expect(mocks.writeOperation).not.toHaveBeenCalled();
});
it("assigned-workflow collection uses its own server permission and strips client roles", async () => {
  const f = new FormData();
  Object.entries({
    operation: "finance:PAYMENT",
    key: randomUUID(),
    trip: randomUUID(),
    customer: randomUUID(),
    role: "ADMIN",
    payment_data: JSON.stringify({
      method: "CASH",
      amount: "1",
      deposit_amount: "0",
      allocations: [],
      verified: true,
    }),
  }).forEach(([k, v]) => f.set(k, v));
  mocks.writeOperation.mockResolvedValue("saved");
  expect(await saveFinance(f)).toBe("saved");
  expect(mocks.requirePermission).toHaveBeenCalledWith("payment:record");
  expect(mocks.writeOperation.mock.calls[0]![0].args.p_data).not.toHaveProperty(
    "verified",
  );
});
it("finance reads authenticate before loading scoped data", async () => {
  mocks.requirePermission.mockRejectedValue(new Error("Denied"));
  await expect(getFinance(false)).rejects.toThrow("Denied");
  expect(mocks.readFinance).not.toHaveBeenCalled();
});
