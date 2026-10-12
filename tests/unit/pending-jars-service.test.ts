import { it, expect, vi, beforeEach } from "vitest";
const guards = vi.hoisted(() => ({ permission: vi.fn(), read: vi.fn() }));
vi.mock("@/services/auth", () => ({ requirePermission: guards.permission }));
vi.mock("@/data-access/pending-jars", () => ({ readPendingJars: guards.read }));
import { getPendingJars } from "@/services/pending-jars";
const id = "00000000-0000-4000-8000-000000000001";
beforeEach(() => {
  vi.clearAllMocks();
  guards.permission.mockResolvedValue(undefined);
  guards.read.mockResolvedValue({ available: true, rows: [] });
});
it("admin read requires permission before data access", async () => {
  guards.permission.mockRejectedValueOnce(new Error("denied"));
  await expect(getPendingJars(true)).rejects.toThrow("denied");
  expect(guards.read).not.toHaveBeenCalled();
});
it("driver directory lookup requires active driver permission even without a load", async () => {
  await getPendingJars(false);
  expect(guards.permission).toHaveBeenLastCalledWith("driver:read");
  expect(guards.read).toHaveBeenCalledWith(null, null, true);
  await getPendingJars(false, id);
  expect(guards.permission).toHaveBeenLastCalledWith("driver:read");
  expect(guards.read).toHaveBeenCalledWith(id, null, false);
});
it("customer filter cannot pass malformed identifiers to data access", async () => {
  await expect(getPendingJars(true, undefined, "malformed")).rejects.toThrow();
  expect(guards.read).not.toHaveBeenCalled();
  await getPendingJars(true, undefined, id);
  expect(guards.permission).toHaveBeenLastCalledWith("admin:read");
  expect(guards.read).toHaveBeenCalledWith(null, id, false);
});
