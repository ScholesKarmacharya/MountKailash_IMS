import { expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readProductDeliveries } from "@/data-access/product-deliveries";

it("does not truncate historical delivery quantities or product kinds at the REST row cap", async () => {
  const rows = Array.from({ length: 1001 }, (_, i) => ({
    visit_id: "visit",
    product_id: String(i),
    full_jars: 0,
    empty_jars: 0,
    cartons: i + 1,
  }));
  const range = vi.fn(async (start: number, end: number) => ({
    data: rows.slice(start, end + 1),
    error: null,
  }));
  const query = {
    select: () => query,
    in: () => query,
    order: () => query,
    range,
  };
  const client = {
    from: (table: string) =>
      table === "visit_items"
        ? query
        : {
            select: () => ({
              in: async (_: string, ids: string[]) => ({
                data: ids.map((id) => ({
                  id,
                  name: "Jar named carton",
                  kind: "BOTTLE_CARTON",
                })),
                error: null,
              }),
            }),
          },
  } as unknown as SupabaseClient;
  const result = await readProductDeliveries(client, ["visit"]);
  expect(result).toHaveLength(1001);
  expect(result[1000]).toMatchObject({ cartons: 1001, kind: "BOTTLE_CARTON" });
  expect(range.mock.calls).toEqual([
    [0, 499],
    [500, 999],
    [1000, 1499],
  ]);
});
it("does not expose provider diagnostics or invent a type when metadata is inaccessible", async () => {
  const errorQuery = {
    select: () => errorQuery,
    in: () => errorQuery,
    order: () => errorQuery,
    range: async () => ({
      data: null,
      error: { message: "PRIVATE_PROVIDER_DIAGNOSTIC" },
    }),
  };
  await expect(
    readProductDeliveries(
      { from: () => errorQuery } as unknown as SupabaseClient,
      ["visit"],
    ),
  ).rejects.toThrow("Delivery details could not be loaded. Please retry.");
  const rows = [
    {
      visit_id: "visit",
      product_id: "product",
      full_jars: 1,
      empty_jars: 0,
      cartons: 0,
    },
  ];
  const query = {
    select: () => query,
    in: () => query,
    order: () => query,
    range: async () => ({ data: rows, error: null }),
  };
  const client = {
    from: (table: string) =>
      table === "visit_items"
        ? query
        : { select: () => ({ in: async () => ({ data: [], error: null }) }) },
  } as unknown as SupabaseClient;
  await expect(readProductDeliveries(client, ["visit"])).rejects.toThrow(
    "Product details could not be loaded. Please retry.",
  );
});
