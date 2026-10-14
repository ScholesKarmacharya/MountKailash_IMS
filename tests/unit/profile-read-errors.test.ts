import { beforeEach, it, expect, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: vi.fn(), profile: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: mocks.user },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: mocks.profile }) }),
    }),
  }),
}));
import { readCurrentProfile } from "@/data-access/profiles";
beforeEach(() => {
  vi.resetAllMocks();
  mocks.user.mockResolvedValue({
    data: { user: { id: crypto.randomUUID() } },
    error: null,
  });
});
it.each([
  ["AuthRetryableFetchError", 0, "NETWORK"],
  ["AuthRetryableFetchError", 503, "TEMPORARY"],
  ["AuthApiError", 429, "TEMPORARY"],
])(
  "preserves identity outage classification %s/%s",
  async (name, status, code) => {
    mocks.user.mockResolvedValue({
      data: { user: null },
      error: { name, status },
    });
    await expect(readCurrentProfile()).rejects.toMatchObject({ code });
    expect(mocks.profile).not.toHaveBeenCalled();
  },
);
it("keeps a genuinely invalid session distinct from network outages", async () => {
  mocks.user.mockResolvedValue({
    data: { user: null },
    error: { name: "AuthApiError", status: 401 },
  });
  expect(await readCurrentProfile()).toBeNull();
});
it.each([
  ["42703", "Missing field", "SCHEMA"],
  ["", "fetch failed", "NETWORK"],
  ["40001", "Retry", "TEMPORARY"],
])("classifies profile query failure %s", async (code, message, category) => {
  mocks.profile.mockResolvedValue({ data: null, error: { code, message } });
  await expect(readCurrentProfile()).rejects.toMatchObject({ code: category });
});
