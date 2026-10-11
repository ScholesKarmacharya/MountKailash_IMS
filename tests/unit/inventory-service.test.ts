import { beforeEach, describe, it, expect, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  guard: vi.fn(),
  rpc: vi.fn(),
  read: vi.fn(),
  day: vi.fn(),
}));
vi.mock("@/services/auth", () => ({ requirePermission: mocks.guard }));
vi.mock("@/data-access/inventory", () => ({
  inventoryRpc: mocks.rpc,
  readInventory: mocks.read,
}));
vi.mock("@/data-access/business-days", () => ({
  readActiveBusinessDay: mocks.day,
}));
import {
  adjustStock,
  saveProduct,
  openInventoryDay,
  getInventory,
} from "@/services/inventory";
describe("inventory server authorization boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.guard.mockRejectedValue(new Error("Forbidden"));
  });
  it.each([
    ["adjust", adjustStock, "stock:adjust"],
    ["product", saveProduct, "product:manage"],
    ["day", openInventoryDay, "day:open"],
  ] as const)(
    "guards %s before validation or RPC",
    async (_name, operation, permission) => {
      await expect(operation(new FormData())).rejects.toThrow("Forbidden");
      expect(mocks.guard).toHaveBeenCalledWith(permission);
      expect(mocks.rpc).not.toHaveBeenCalled();
    },
  );
  it("denies warehouse reads before querying", async () => {
    await expect(getInventory()).rejects.toThrow("Forbidden");
    expect(mocks.read).not.toHaveBeenCalled();
  });
});
