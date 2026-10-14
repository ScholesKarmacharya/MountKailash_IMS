import { beforeEach, describe, it, expect, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  guard: vi.fn(),
  rpc: vi.fn(),
  read: vi.fn(),
  day: vi.fn(),
  identity: vi.fn(),
}));
vi.mock("@/services/auth", () => ({ requirePermission: mocks.guard }));
vi.mock("@/data-access/inventory", () => ({
  inventoryRpc: mocks.rpc,
  readInventory: mocks.read,
  readProductIdentity: mocks.identity,
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
      expect(mocks.identity).not.toHaveBeenCalled();
    },
  );
  it("denies warehouse reads before querying", async () => {
    await expect(getInventory()).rejects.toThrow("Forbidden");
    expect(mocks.read).not.toHaveBeenCalled();
  });
});

describe("product catalog identity protection", () => {
  const id = "00000000-0000-0000-0000-000000000011";
  function productForm(overrides: Record<string, string> = {}) {
    const form = new FormData();
    for (const [key, value] of Object.entries({
      id,
      key: "00000000-0000-0000-0000-000000000099",
      version: "1",
      name: "Water jar",
      sku: "JAR",
      kind: "FULL_JAR",
      unit: "jar",
      price: "175.50",
      active: "true",
      reason: "Reviewed catalog update",
      ...overrides,
    }))
      form.set(key, value);
    return form;
  }
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.guard.mockResolvedValue({});
    mocks.identity.mockResolvedValue({
      sku: "JAR",
      kind: "FULL_JAR",
      unit: "jar",
    });
    mocks.rpc.mockResolvedValue(id);
  });
  it.each<Record<string, string>>([
    { sku: "NEW-JAR" },
    { kind: "BOTTLE_CARTON" },
    { unit: "crate" },
  ])(
    "rejects a forged identifier or inventory unit change %j",
    async (change) => {
      await expect(saveProduct(productForm(change))).rejects.toThrow(
        "fixed to protect stock",
      );
      expect(mocks.identity).toHaveBeenCalledWith(id);
      expect(mocks.rpc).not.toHaveBeenCalled();
    },
  );
  it("keeps the existing RPC for audited name, price and status edits", async () => {
    await saveProduct(productForm({ name: "Renamed jar", active: "false" }));
    expect(mocks.rpc).toHaveBeenCalledWith(
      "save_product",
      expect.objectContaining({
        p_id: id,
        p_name: "Renamed jar",
        p_price: "175.50",
        p_active: false,
        p_unit: "jar",
        p_sku: "JAR",
      }),
    );
  });
  it("allows actual custom units when creating a new product", async () => {
    mocks.identity.mockResolvedValue(null);
    await saveProduct(
      productForm({ version: "0", unit: "crate", kind: "BOTTLE_CARTON" }),
    );
    expect(mocks.rpc).toHaveBeenCalledWith(
      "save_product",
      expect.objectContaining({ p_unit: "crate", p_kind: "BOTTLE_CARTON" }),
    );
  });
  it("stops saving when the current identity cannot be checked", async () => {
    mocks.identity.mockRejectedValue(
      new Error("Product could not be checked. Refresh and try again."),
    );
    await expect(saveProduct(productForm())).rejects.toThrow(
      "could not be checked",
    );
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("retains the mandatory creation audit reason before reading or writing", async () => {
    await expect(
      saveProduct(productForm({ version: "0", reason: "" })),
    ).rejects.toThrow();
    expect(mocks.identity).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
