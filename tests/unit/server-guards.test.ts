import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  profile: vi.fn(),
  configured: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/data-access/profiles", () => ({
  readCurrentProfile: mocks.profile,
}));
vi.mock("@/lib/supabase/env", () => ({ supabaseConfig: mocks.configured }));
import { requirePermission } from "@/services/auth";
describe("route and service guards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.configured.mockReturnValue({ url: "local", key: "public" });
  });
  it("denies unconfigured access", async () => {
    mocks.configured.mockReturnValue(null);
    await expect(requirePermission("admin:read")).rejects.toThrow(
      "REDIRECT:/sign-in?reason=configuration",
    );
    expect(mocks.profile).not.toHaveBeenCalled();
  });
  it("denies missing profiles", async () => {
    mocks.profile.mockResolvedValue(null);
    await expect(requirePermission("admin:read")).rejects.toThrow(
      "REDIRECT:/account",
    );
  });
  it("denies disabled admins", async () => {
    mocks.profile.mockResolvedValue({ role: "ADMIN", is_active: false });
    await expect(requirePermission("admin:read")).rejects.toThrow(
      "REDIRECT:/sign-in?reason=access",
    );
  });
  it("denies direct driver access to admin service", async () => {
    mocks.profile.mockResolvedValue({ role: "DRIVER", is_active: true });
    await expect(requirePermission("admin:read")).rejects.toThrow(
      "REDIRECT:/driver/home",
    );
  });
  it.each(["PENDING", "REJECTED", "SUSPENDED"])(
    "checks current %s status on every service call",
    async (status) => {
      mocks.profile.mockResolvedValue({
        role: "DRIVER",
        is_active: true,
        approval_status: status,
      });
      await expect(requirePermission("customer:operate")).rejects.toThrow(
        "REDIRECT:/account",
      );
    },
  );
  it("returns enabled authorized identity", async () => {
    const profile = { id: "a", role: "ADMIN", is_active: true };
    mocks.profile.mockResolvedValue(profile);
    expect(await requirePermission("admin:read")).toEqual(profile);
  });
});
