import { expect, it, vi, beforeEach } from "vitest";
const mocks = vi.hoisted(() => ({
  permission: vi.fn(),
  workspace: vi.fn(),
  history: vi.fn(),
}));
vi.mock("@/services/auth", () => ({ requirePermission: mocks.permission }));
vi.mock("@/data-access/admin-jars", () => ({
  readAdminJars: mocks.workspace,
  readAdminJarHistory: mocks.history,
}));
import { getAdminJars, getAdminJarHistory } from "@/services/admin-jars";
import { presetRange } from "@/domain/localization/calendar";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.permission.mockResolvedValue(undefined);
});
it("guards admin reads before accessing any customer history", async () => {
  mocks.permission.mockRejectedValue(new Error("denied"));
  await expect(getAdminJars()).rejects.toThrow("denied");
  await expect(
    getAdminJarHistory("00000000-0000-0000-0000-000000000001"),
  ).rejects.toThrow("denied");
  expect(mocks.workspace).not.toHaveBeenCalled();
  expect(mocks.history).not.toHaveBeenCalled();
});
it("passes a BS month range in Nepal timezone and validates identifiers", async () => {
  vi.useFakeTimers();
  try {
    vi.setSystemTime(new Date("2026-10-14T18:15:00Z"));
    await getAdminJars();
    expect(mocks.permission).toHaveBeenCalledWith("admin:read");
    expect(mocks.workspace).toHaveBeenCalledWith(presetRange("month"));
    await expect(getAdminJarHistory("invalid")).rejects.toThrow(
      "Invalid record",
    );
    expect(mocks.history).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});
