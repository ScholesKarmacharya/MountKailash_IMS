import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ client: vi.fn(), guard: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.client }));
vi.mock("@/services/auth", () => ({ requirePermission: mocks.guard }));
import {
  readWarehouseActivity,
  readDamagedStock,
  readProcessingHistory,
} from "@/data-access/warehouse-ui";
import {
  getWarehouseActivity,
  getWarehouseDamage,
  getProcessingHistory,
} from "@/services/warehouse-ui";
import { inventoryHistoryFilter } from "@/domain/inventory/presentation";
class Query {
  select = vi.fn(() => this);
  eq = vi.fn(() => this);
  neq = vi.fn(() => this);
  in = vi.fn(() => this);
  or = vi.fn(() => this);
  order = vi.fn(() => this);
  gte = vi.fn(() => this);
  lte = vi.fn(() => this);
  lt = vi.fn(() => this);
  range = vi.fn(() => this);
  single = vi.fn(async () => this.response);
  maybeSingle = vi.fn(async () => this.response);
  constructor(
    readonly response: { data: unknown; error: { code: string } | null },
  ) {}
  then(resolve: (result: typeof this.response) => unknown) {
    return Promise.resolve(this.response).then(resolve);
  }
}
function client(responses: Record<string, Query[]>) {
  mocks.client.mockResolvedValue({
    from: vi.fn((table: string) => {
      const query = responses[table]?.shift();
      if (!query) throw Error("Unexpected test query: " + table);
      return query;
    }),
  });
}
const ok = (data: unknown) => new Query({ data, error: null });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.guard.mockResolvedValue({});
});
it("filters warehouse activity at the database before paging and preserves Nepal midnight bounds", async () => {
  const moves = ok(Array.from({ length: 26 }, (_, i) => ({ id: String(i) }))),
    main = ok({ id: "main" });
  client({ stock_movements: [moves], stock_locations: [main] });
  const filter = inventoryHistoryFilter({
    from: "2026-10-14",
    to: "2026-10-14",
    page: "2",
    product: "00000000-0000-0000-0000-000000000011",
  });
  const result = await readWarehouseActivity(filter);
  expect(main.eq).toHaveBeenCalledWith("code", "MAIN");
  expect(main.eq).toHaveBeenCalledWith("kind", "WAREHOUSE");
  expect(moves.or).toHaveBeenCalledWith(
    "from_location_id.eq.main,to_location_id.eq.main",
  );
  expect(moves.gte).toHaveBeenCalledWith(
    "created_at",
    "2026-10-13T18:15:00.000Z",
  );
  expect(moves.lt).toHaveBeenCalledWith(
    "created_at",
    "2026-10-14T18:15:00.000Z",
  );
  expect(moves.neq).toHaveBeenCalledWith("movement_type", "REFILL_INPUT");
  expect(moves.range).toHaveBeenCalledWith(50, 75);
  expect(result.rows).toHaveLength(25);
  expect(result.hasMore).toBe(true);
});
it("fetches both original batch legs without cutting them at the activity page or state boundary", async () => {
  const moves = ok([{ id: "input", processing_id: "batch" }]),
    pair = ok([{ id: "input" }, { id: "output" }]);
  client({ stock_movements: [moves, pair] });
  const result = await readWarehouseActivity(
    inventoryHistoryFilter({ scope: "company", state: "EMPTY_JAR" }),
  );
  expect(moves.eq).toHaveBeenCalledWith("stock_kind", "EMPTY_JAR");
  expect(moves.neq).not.toHaveBeenCalled();
  expect(pair.in).toHaveBeenCalledWith("processing_id", ["batch"]);
  expect(pair.range).not.toHaveBeenCalled();
  expect(result.related).toHaveLength(2);
});
it("retains processing history's posting-day filtering for overnight records", async () => {
  const query = ok([]);
  client({ warehouse_processing: [query] });
  await readProcessingHistory(
    inventoryHistoryFilter({
      from: "2026-10-13",
      to: "2026-10-13",
      state: "EMPTY_JAR",
    }),
  );
  expect(query.gte).toHaveBeenCalledWith(
    "business_days.date_label",
    "2026-10-13",
  );
  expect(query.lte).toHaveBeenCalledWith(
    "business_days.date_label",
    "2026-10-13",
  );
  expect(query.gte).not.toHaveBeenCalledWith("created_at", expect.anything());
  expect(query.select).toHaveBeenCalledWith(
    expect.stringContaining("movements:stock_movements(*)"),
  );
});
it("distinguishes an untracked quarantine location from zero tracked damage", async () => {
  client({ stock_locations: [ok(null)] });
  expect(await readDamagedStock()).toEqual({ tracked: false, balances: [] });
});
it("reads every damaged balance beyond the provider row cap", async () => {
  const data = Array.from({ length: 1002 }, (_, i) => ({
    product_id: String(i),
    stock_kind: "EMPTY_JAR",
    quantity: 2,
  }));
  const queries = [
    ok(data.slice(0, 500)),
    ok(data.slice(500, 1000)),
    ok(data.slice(1000)),
  ];
  client({
    stock_locations: [ok({ id: "damaged" })],
    inventory_balances: [...queries],
  });
  const result = await readDamagedStock();
  expect(result.tracked).toBe(true);
  expect(result.balances).toHaveLength(1002);
  expect(queries[2]!.range).toHaveBeenCalledWith(1000, 1499);
});
it("does not present provider failures as zero stock or empty history", async () => {
  client({
    stock_locations: [new Query({ data: null, error: { code: "42501" } })],
  });
  await expect(readDamagedStock()).rejects.toThrow("could not be loaded");
});
it("reports unavailable processing configuration separately", async () => {
  client({
    warehouse_processing: [new Query({ data: null, error: { code: "42P01" } })],
  });
  expect(await readProcessingHistory(inventoryHistoryFilter({}))).toMatchObject(
    { available: false },
  );
});
it.each([getWarehouseActivity, getProcessingHistory, getWarehouseDamage])(
  "guards the new read-only workspace before database access",
  async (operation) => {
    mocks.guard.mockRejectedValue(new Error("Forbidden"));
    await expect(operation({})).rejects.toThrow("Forbidden");
    expect(mocks.guard).toHaveBeenCalledWith("admin:read");
    expect(mocks.client).not.toHaveBeenCalled();
  },
);
