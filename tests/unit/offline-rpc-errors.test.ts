import { beforeEach, expect, it, vi } from "vitest";
const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc }),
}));
import { offlineRpc } from "@/data-access/offline";
beforeEach(() => vi.resetAllMocks());
it.each([
  ["MK001", "An explicit warehouse admin device reset is required."],
  [
    "42501",
    "Only one trusted device is allowed. Ask the admin to review the existing device.",
  ],
  ["42501", "An explicit admin device reset is required for this trip."],
  ["42501", "Use the registered offline device for this delivery round."],
])(
  "returns an explicit device ownership conflict for %s / %s",
  async (code, message) => {
    rpc.mockResolvedValue({ error: { code, message } });
    await expect(
      offlineRpc("offline_preparation_access"),
    ).rejects.toMatchObject({
      code: "DEVICE_RESET_REQUIRED",
      status: 403,
      message:
        "This trip is linked to another phone. Ask the warehouse admin to reset offline access.",
    });
  },
);
it("does not turn arbitrary authorization failures into an ownership diagnosis or expose provider details", async () => {
  rpc.mockResolvedValue({
    error: { code: "42501", message: "Private provider details" },
  });
  await expect(offlineRpc("offline_preparation_access")).rejects.toMatchObject({
    code: "AUTHORIZATION",
    status: 403,
  });
});
