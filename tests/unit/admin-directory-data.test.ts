import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  client: vi.fn(),
  guard: vi.fn(),
  read: vi.fn(),
  write: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.client }));
vi.mock("@/services/auth", () => ({
  requirePermission: mocks.guard,
  requireIdentity: vi.fn(),
}));
vi.mock("@/data-access/accounts", () => ({
  readDriverAccounts: mocks.read,
  writeAccount: mocks.write,
  readDriverAudit: vi.fn(),
}));
import { readTripLoads } from "@/data-access/history";
import { getTripLoads } from "@/services/history";
import { saveAccount } from "@/services/accounts";
class Query {
  select = vi.fn(() => this);
  in = vi.fn(() => this);
  order = vi.fn(() => this);
  range = vi.fn(() => this);
  constructor(readonly result: { data: unknown[]; error: unknown }) {}
  then(resolve: (value: typeof this.result) => unknown) {
    return Promise.resolve(this.result).then(resolve);
  }
}
beforeEach(() => vi.resetAllMocks());
it("fetches original load rows past the provider cap in deterministic pages", async () => {
  const first = new Query({
      data: Array.from({ length: 500 }, (_, n) => ({ quantity: n })),
      error: null,
    }),
    second = new Query({ data: [{ quantity: 501 }], error: null });
  const from = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second);
  mocks.client.mockResolvedValue({ from });
  const id = crypto.randomUUID();
  expect(await readTripLoads([id])).toHaveLength(501);
  expect(first.in).toHaveBeenCalledWith("trip_id", [id]);
  expect(first.range).toHaveBeenCalledWith(0, 499);
  expect(second.range).toHaveBeenCalledWith(500, 999);
});
it("does not query empty trip lists or disguise failures as zero loaded stock", async () => {
  expect(await readTripLoads([])).toEqual([]);
  expect(mocks.client).not.toHaveBeenCalled();
  mocks.client.mockResolvedValue({
    from: () => new Query({ data: [], error: { code: "42501" } }),
  });
  await expect(readTripLoads([crypto.randomUUID()])).rejects.toThrow(
    "could not be loaded",
  );
});
it("rejects unauthorized reads before reading any load quantities", async () => {
  mocks.guard.mockRejectedValue(new Error("Admin access required"));
  await expect(getTripLoads([crypto.randomUUID()])).rejects.toThrow(
    "Admin access required",
  );
  expect(mocks.client).not.toHaveBeenCalled();
});
function form(id: string, create: boolean) {
  const form = new FormData();
  for (const [k, v] of Object.entries({
    operation: "account:driver",
    id,
    version: "0",
    name: "Verified driver",
    phone: "",
    approve: "false",
    reason: "Admin verified account",
    key: crypto.randomUUID(),
    create_new: String(create),
  }))
    form.set(k, v);
  return form;
}
it("prevents Add Driver from overwriting a linked profile with initial version zero", async () => {
  const id = crypto.randomUUID();
  mocks.read.mockResolvedValue({
    available: true,
    drivers: [{ id, version: 0 }],
  });
  await expect(saveAccount(form(id, true))).rejects.toThrow("already exists");
  expect(mocks.write).not.toHaveBeenCalled();
});
it("allows explicit profile editing and new pending linkage through existing RPC", async () => {
  const id = crypto.randomUUID();
  mocks.read.mockResolvedValue({ available: true, drivers: [] });
  mocks.write.mockResolvedValue(id);
  await expect(saveAccount(form(id, true))).resolves.toBe(id);
  await expect(saveAccount(form(id, false))).resolves.toBe(id);
  expect(mocks.read).toHaveBeenCalledTimes(1);
  expect(mocks.write).toHaveBeenCalledWith(
    expect.objectContaining({
      rpc: "save_driver_account",
      args: expect.objectContaining({ p_approve: false, p_id: id }),
    }),
  );
});
