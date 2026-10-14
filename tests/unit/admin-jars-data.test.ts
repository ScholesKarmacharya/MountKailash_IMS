import { expect, it, vi, beforeEach } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc: mocks.rpc }),
}));
import { readAdminJars, readAdminJarHistory } from "@/data-access/admin-jars";
import { presetRange } from "@/domain/localization/calendar";
beforeEach(() => vi.clearAllMocks());
it("shows migration unavailability separately from genuine zero totals and surfaces permission failures", async () => {
  const month = presetRange("month");
  mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "PGRST202" } });
  expect((await readAdminJars(month)).available).toBe(false);
  expect(mocks.rpc).toHaveBeenCalledWith("admin_jar_workspace", {
    p_month_start: month.start,
    p_month_end: month.end,
  });
  mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "42501" } });
  await expect(readAdminJars(month)).rejects.toThrow("could not be loaded");
  mocks.rpc.mockResolvedValueOnce({
    data: { customers: [], snapshot_at: "now" },
    error: null,
  });
  expect((await readAdminJars(month)).available).toBe(true);
});
it("retrieves complete history through the authorized RPC and does not mask errors", async () => {
  mocks.rpc.mockResolvedValueOnce({ data: { events: [] }, error: null });
  expect(await readAdminJarHistory("customer")).toEqual({ events: [] });
  expect(mocks.rpc).toHaveBeenCalledWith("admin_jar_history", {
    p_customer: "customer",
  });
  mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "42501" } });
  await expect(readAdminJarHistory("customer")).rejects.toThrow(
    "could not be loaded",
  );
});
