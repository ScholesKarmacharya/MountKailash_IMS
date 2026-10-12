import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  from: vi.fn(),
  select: vi.fn(),
  eq: vi.fn(),
  maybeSingle: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: mocks.getUser },
    from: mocks.from,
  }),
}));
import { readCurrentProfile } from "@/data-access/profiles";
describe("database-backed identity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.from.mockReturnValue({ select: mocks.select });
    mocks.select.mockReturnValue({ eq: mocks.eq });
    mocks.eq.mockReturnValue({ maybeSingle: mocks.maybeSingle });
  });
  it("does not query profiles for an unverified session", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: null },
      error: new Error("expired"),
    });
    expect(await readCurrentProfile()).toBeNull();
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it("ignores forged auth metadata and scopes profile to verified user ID", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { id: "driver-id", user_metadata: { role: "ADMIN" } } },
      error: null,
    });
    mocks.maybeSingle.mockResolvedValue({
      data: {
        id: "driver-id",
        name: "Driver",
        role: "DRIVER",
        is_active: true,
      },
      error: null,
    });
    expect((await readCurrentProfile())?.role).toBe("DRIVER");
    expect(mocks.eq).toHaveBeenCalledWith("id", "driver-id");
  });
  it("rejects unknown profile roles", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { id: "u" } },
      error: null,
    });
    mocks.maybeSingle.mockResolvedValue({
      data: { id: "u", role: "OWNER" },
      error: null,
    });
    expect(await readCurrentProfile()).toBeNull();
  });
  it("fails closed when the database is unavailable", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { id: "u" } },
      error: null,
    });
    mocks.maybeSingle.mockResolvedValue({
      data: null,
      error: new Error("database detail"),
    });
    await expect(readCurrentProfile()).rejects.toThrow(
      "Account access could not be checked",
    );
  });
  it("reads approval and full name from the database, ignoring user-supplied access claims", async () => {
    mocks.getUser.mockResolvedValue({
      data: {
        user: {
          id: "driver-id",
          email: "driver@test.example",
          user_metadata: {
            role: "ADMIN",
            approval_status: "APPROVED",
            name: "Forged name",
          },
        },
      },
      error: null,
    });
    mocks.maybeSingle.mockResolvedValue({
      data: {
        id: "driver-id",
        name: "Ram Thapa",
        role: "DRIVER",
        is_active: false,
        approval_status: "PENDING",
        phone: "123",
        version: 2,
      },
      error: null,
    });
    expect(await readCurrentProfile()).toMatchObject({
      id: "driver-id",
      name: "Ram Thapa",
      role: "DRIVER",
      is_active: false,
      approval_status: "PENDING",
      phone: "123",
      version: 2,
      email: "driver@test.example",
    });
  });
  it("fails closed on an unknown approval status instead of treating it as legacy access", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { id: "driver-id" } },
      error: null,
    });
    mocks.maybeSingle.mockResolvedValue({
      data: {
        id: "driver-id",
        role: "DRIVER",
        is_active: true,
        approval_status: "UNKNOWN",
      },
      error: null,
    });
    await expect(readCurrentProfile()).rejects.toThrow(
      "Account access could not be checked",
    );
  });
  it("uses a blank name for the role fallback and supports trusted pre-migration profiles", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { id: "driver-id" } },
      error: null,
    });
    mocks.maybeSingle.mockResolvedValue({
      data: { id: "driver-id", role: "DRIVER", is_active: true, name: null },
      error: null,
    });
    expect(await readCurrentProfile()).toMatchObject({
      name: "",
      role: "DRIVER",
      is_active: true,
      approval_status: undefined,
    });
  });
});
