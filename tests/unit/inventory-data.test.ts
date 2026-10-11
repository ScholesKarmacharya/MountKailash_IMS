import { beforeEach, describe, it, expect, vi } from "vitest";
const mocks = vi.hoisted(() => ({ client: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.client }));
import { readInventory, inventoryRpc } from "@/data-access/inventory";
import { stockTotals } from "@/domain/inventory/validation";
describe("warehouse reads and safe RPC errors", () => {
  beforeEach(() => vi.clearAllMocks());
  it("loads stock beyond the API row cap without understating dashboard totals", async () => {
    const products = Array.from({ length: 1002 }, (_, i) => ({
      id: String(i),
      sku: `JAR${i}`,
      name: `Jar ${i}`,
      kind: "FULL_JAR",
      unit: "jar",
      default_price: 150.25,
      is_active: true,
      version: 1,
    }));
    const balances = products.map((p) => ({
      product_id: p.id,
      stock_kind: "FULL_JAR",
      quantity: 2,
    }));
    const from = (table: string) => {
      const rows =
        table === "products"
          ? products
          : table === "inventory_balances"
            ? balances
            : [];
      const builder = {
        select: () => builder,
        eq: () => builder,
        order: () => builder,
        single: async () => ({ data: { id: "warehouse" }, error: null }),
        range: async (start: number, end: number) => ({
          data: rows.slice(start, end + 1),
          error: null,
        }),
      };
      return builder;
    };
    mocks.client.mockResolvedValue({ from });
    const snapshot = await readInventory();
    expect(snapshot.available).toBe(true);
    expect(snapshot.products).toHaveLength(1002);
    expect(stockTotals(snapshot.balances).FULL_JAR).toBe(2004);
    expect(snapshot.products[0]?.default_price).toBe("150.25");
  });
  it("missing migration is unavailable, never invented zero stock", async () => {
    const builder = {
      select: () => builder,
      eq: () => builder,
      single: async () => ({ data: null, error: { code: "PGRST205" } }),
    };
    mocks.client.mockResolvedValue({ from: () => builder });
    expect((await readInventory()).available).toBe(false);
  });
  it("provider errors do not expose raw secret-bearing diagnostics", async () => {
    mocks.client.mockResolvedValue({
      rpc: async () => ({
        data: null,
        error: { code: "XX000", message: "PRIVATE_PROVIDER_DIAGNOSTIC" },
      }),
    });
    await expect(inventoryRpc("adjust_warehouse_stock", {})).rejects.toThrow(
      "Unable to save.",
    );
  });
});
