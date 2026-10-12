import { beforeEach, describe, it, expect, vi } from "vitest";
const mocks = vi.hoisted(() => ({ client: vi.fn(), guard: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.client }));
vi.mock("@/services/auth", () => ({ requirePermission: mocks.guard }));
import { readStockHistory, readTripHistory } from "@/data-access/history";
import { readStatementLedger } from "@/data-access/finance";
import { getStockHistory, getTripHistory } from "@/services/history";
import { bsMonthRange } from "@/domain/localization/calendar";
describe("BS history filters query canonical data through caller RLS", () => {
  beforeEach(() => vi.clearAllMocks());
  function builder(data: unknown[] = []) {
    const q = {
      select: vi.fn(),
      order: vi.fn(),
      eq: vi.fn(),
      gte: vi.fn(),
      lte: vi.fn(),
      lt: vi.fn(),
      range: vi.fn().mockResolvedValue({ data, error: null }),
    };
    for (const name of ["select", "order", "eq", "gte", "lte", "lt"] as const)
      q[name].mockReturnValue(q);
    mocks.client.mockResolvedValue({ from: () => q });
    return q;
  }
  it("monthly statements retain prior credit and exclude next-month transactions in the database", async () => {
    const q = builder(),
      r = bsMonthRange(2083, 6);
    await readStatementLedger("customer", r);
    expect(q.eq).toHaveBeenCalledWith("customer_id", "customer");
    expect(q.lt).toHaveBeenCalledWith("created_at", "2026-10-17T18:15:00.000Z");
  });
  it("stock movement dates use Nepal midnight with an exclusive end", async () => {
    const q = builder(),
      r = bsMonthRange(2083, 6);
    await readStockHistory(r, 2);
    expect(q.gte).toHaveBeenCalledWith(
      "created_at",
      "2026-09-16T18:15:00.000Z",
    );
    expect(q.lt).toHaveBeenCalledWith("created_at", "2026-10-17T18:15:00.000Z");
    expect(q.range).toHaveBeenCalledWith(50, 75);
  });
  it("trip histories use the original business-date session including overnight trips", async () => {
    const q = builder(),
      r = bsMonthRange(2083, 6);
    await readTripHistory(r);
    expect(q.gte).toHaveBeenCalledWith("business_days.date_label", r.from);
    expect(q.lte).toHaveBeenCalledWith("business_days.date_label", r.to);
  });
  it("denies warehouse history before reading the database", async () => {
    mocks.guard.mockRejectedValue(new Error("Forbidden"));
    await expect(getStockHistory()).rejects.toThrow("Forbidden");
    expect(mocks.client).not.toHaveBeenCalled();
  });
  it("guards driver history and keeps the caller session rather than accepting a driver ID", async () => {
    mocks.guard.mockResolvedValue({ id: "driver", role: "DRIVER" });
    builder();
    const r = bsMonthRange(2083, 6);
    expect(await getTripHistory(r.from, r.to, false)).toEqual([]);
    expect(mocks.guard).toHaveBeenCalledWith("driver:read");
  });
});
