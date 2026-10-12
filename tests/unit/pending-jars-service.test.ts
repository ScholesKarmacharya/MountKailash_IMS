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
it("driver read requires an assigned valid trip and trip permission", async () => {
  await expect(getPendingJars(false)).rejects.toThrow("assigned trip");
  expect(guards.read).not.toHaveBeenCalled();
  await getPendingJars(false, id);
  expect(guards.permission).toHaveBeenLastCalledWith("trip:operate");
  expect(guards.read).toHaveBeenCalledWith(id, null);
});
it("customer filter cannot pass malformed identifiers to data access", async () => {
  await expect(getPendingJars(true, undefined, "malformed")).rejects.toThrow();
  expect(guards.read).not.toHaveBeenCalled();
  await getPendingJars(true, undefined, id);
  expect(guards.permission).toHaveBeenLastCalledWith("admin:read");
  expect(guards.read).toHaveBeenCalledWith(null, id);
});
