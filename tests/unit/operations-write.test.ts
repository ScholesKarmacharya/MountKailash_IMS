import { afterEach, beforeEach, it, expect, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc: mocks.rpc }),
}));
import { writeOperation } from "@/data-access/operations";
import type { Command } from "@/domain/operations/commands";
const command = (rpc = "schedule_trip"): Command => ({
  rpc,
  args: { p_notes: "Private customer details" },
  admin: true,
});
beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());
it.each([
  ["schedule_trip", "PGRST202", 404],
  ["trip_preparation_command", "PGRST202", 404],
  ["schedule_trip", "42883", 404],
  ["trip_preparation_command", "42703", 400],
])(
  "explains missing overnight schema for %s/%s without exposing request data",
  async (rpc, code, status) => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code, message: "Internal schema details" },
      status,
    });
    await expect(writeOperation(command(rpc as string))).rejects.toThrow(
      "Apply the reviewed migrations 22 and 23",
    );
    expect(console.error).toHaveBeenCalledWith("operation_save_failed", {
      rpc,
      status,
      databaseCode: code,
    });
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(
      "Private customer details",
    );
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  },
);
it("preserves authored authorization failures instead of misclassifying them as missing schema", async () => {
  mocks.rpc.mockResolvedValue({
    data: null,
    error: { code: "42501", message: "Not authorized for this operation." },
    status: 403,
  });
  await expect(writeOperation(command())).rejects.toThrow(
    "Not authorized for this operation.",
  );
});
it("does not blame overnight migrations for an unrelated missing RPC", async () => {
  mocks.rpc.mockResolvedValue({
    data: null,
    error: { code: "PGRST202", message: "Internal details" },
    status: 404,
  });
  await expect(writeOperation(command("save_customer"))).rejects.toThrow(
    "Unable to save this operation.",
  );
});
it("returns only the acknowledged saved record identifier", async () => {
  const id = crypto.randomUUID();
  mocks.rpc.mockResolvedValue({ data: id, error: null, status: 200 });
  await expect(writeOperation(command())).resolves.toBe(id);
  expect(console.error).not.toHaveBeenCalled();
});
