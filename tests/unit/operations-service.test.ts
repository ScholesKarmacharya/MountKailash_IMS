import { beforeEach, it, expect, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  guard: vi.fn(),
  read: vi.fn(),
  write: vi.fn(),
  customer: vi.fn(),
}));
vi.mock("@/services/auth", () => ({ requirePermission: mocks.guard }));
vi.mock("@/data-access/operations", () => ({
  readOperations: mocks.read,
  writeOperation: mocks.write,
  readDeliveryCustomer: mocks.customer,
}));
import {
  getOperations,
  saveOperation,
  getDeliveryCustomer,
} from "@/services/operations";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.guard.mockRejectedValue(new Error("Forbidden"));
});
it("checks selected-customer permission before data access", async () => {
  await expect(
    getDeliveryCustomer(
      "00000000-0000-0000-0000-000000000001",
      "00000000-0000-0000-0000-000000000002",
    ),
  ).rejects.toThrow("Forbidden");
  expect(mocks.guard).toHaveBeenCalledWith("customer:operate");
  expect(mocks.customer).not.toHaveBeenCalled();
});
it("rejects invalid selected-customer identifiers before a query", async () => {
  mocks.guard.mockResolvedValue({ role: "DRIVER" });
  await expect(getDeliveryCustomer("invalid", "invalid")).rejects.toThrow(
    "identifier",
  );
  expect(mocks.customer).not.toHaveBeenCalled();
});
it.each([true, false])(
  "guards workspace reads for admin=%s before data access",
  async (admin) => {
    await expect(getOperations(admin)).rejects.toThrow("Forbidden");
    expect(mocks.guard).toHaveBeenCalledWith(
      admin ? "admin:read" : "driver:read",
    );
    expect(mocks.read).not.toHaveBeenCalled();
  },
);
it.each(["start", "load", "driver-visit"])(
  "guards %s mutations before database access",
  async (operation) => {
    const form = new FormData();
    for (const [key, value] of Object.entries({
      operation,
      key: "00000000-0000-0000-0000-000000000001",
      trip: "00000000-0000-0000-0000-000000000002",
      items: "[]",
      customer: "00000000-0000-0000-0000-000000000001",
      walk_name: "",
      walk_phone: "",
      notes: "",
      payment_status: "PAID",
      received_amount: "1.00",
    }))
      form.set(key, value);
    await expect(saveOperation(form)).rejects.toThrow("Forbidden");
    expect(mocks.guard).toHaveBeenCalledWith(
      operation === "load" ? "trip:assign" : "trip:operate",
    );
    expect(mocks.write).not.toHaveBeenCalled();
  },
);
