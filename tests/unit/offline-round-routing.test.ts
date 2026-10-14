import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  select: vi.fn(),
  eq: vi.fn(),
  read: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from: mocks.from }),
}));
import { readOfflineRound } from "@/data-access/offline";
beforeEach(() => {
  vi.resetAllMocks();
  mocks.from.mockReturnValue({ select: mocks.select });
  mocks.select.mockReturnValue({ eq: mocks.eq });
  mocks.eq.mockReturnValue({ maybeSingle: mocks.read });
});
it("uses the authenticated RLS lookup with only public round fields", async () => {
  mocks.read.mockResolvedValue({
    data: { trip_id: "trip", phase: "ACTIVE" },
    error: null,
  });
  expect(await readOfflineRound("trip")).toEqual({
    trip_id: "trip",
    phase: "ACTIVE",
  });
  expect(mocks.from).toHaveBeenCalledWith("driver_offline_rounds");
  expect(mocks.select).toHaveBeenCalledWith("trip_id,phase");
  expect(mocks.eq).toHaveBeenCalledWith("trip_id", "trip");
});
it("keeps unregistered rounds on the regular online path", async () => {
  mocks.read.mockResolvedValue({ data: null, error: null });
  expect(await readOfflineRound("trip")).toBeNull();
});
it.each(["42501", "PGRST205", "FETCH_ERROR"])(
  "fails closed for unavailable routing metadata: %s",
  async (code) => {
    mocks.read.mockResolvedValue({ data: null, error: { code } });
    await expect(readOfflineRound("trip")).rejects.toThrow(
      "Delivery round access could not be checked. Please retry.",
    );
  },
);
