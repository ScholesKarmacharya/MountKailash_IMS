import { it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
const mocks = vi.hoisted(() => ({
  requirePermission: vi.fn(),
  writeOperation: vi.fn(),
  readDayHistory: vi.fn(),
  readDayReport: vi.fn(),
}));
vi.mock("@/services/auth", () => ({
  requirePermission: mocks.requirePermission,
}));
vi.mock("@/data-access/operations", () => ({
  writeOperation: mocks.writeOperation,
}));
vi.mock("@/data-access/day-reports", () => ({
  readDayHistory: mocks.readDayHistory,
  readDayReport: mocks.readDayReport,
}));
import { saveDay, getDayHistory, getDayReport } from "@/services/business-days";
beforeEach(() => vi.resetAllMocks());
it("server denial stops closing before database calls irrespective of forged fields", async () => {
  mocks.requirePermission.mockRejectedValue(new Error("Denied"));
  const f = new FormData();
  f.set("role", "ADMIN");
  await expect(saveDay(f)).rejects.toThrow("Denied");
  expect(mocks.requirePermission).toHaveBeenCalledWith("day:close");
  expect(mocks.writeOperation).not.toHaveBeenCalled();
});
it("history and private exports cannot read data until admin authorization succeeds", async () => {
  mocks.requirePermission.mockRejectedValue(new Error("Denied"));
  await expect(getDayHistory()).rejects.toThrow("Denied");
  await expect(getDayReport(randomUUID())).rejects.toThrow("Denied");
  expect(mocks.requirePermission).toHaveBeenCalledWith("admin:read");
  expect(mocks.readDayHistory).not.toHaveBeenCalled();
  expect(mocks.readDayReport).not.toHaveBeenCalled();
});
it("invalid report IDs and date ranges do not reach Supabase", async () => {
  expect(await getDayReport("bad-id")).toBeNull();
  await expect(getDayHistory("2026-10-12", "2026-10-11")).rejects.toThrow(
    /Start date/,
  );
  expect(mocks.readDayHistory).not.toHaveBeenCalled();
  expect(mocks.readDayReport).not.toHaveBeenCalled();
});
