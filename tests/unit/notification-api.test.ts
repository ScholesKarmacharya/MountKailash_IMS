import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ profile: vi.fn(), rpc: vi.fn() }));
vi.mock("@/data-access/profiles", () => ({
  readCurrentProfile: mocks.profile,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc: mocks.rpc }),
}));
import { GET, POST } from "@/app/api/notifications/route";
const url = "https://mount.example/api/notifications";
const post = (body: unknown, origin = "https://mount.example") =>
  POST(
    new Request(url, {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
beforeEach(() => {
  mocks.profile.mockReset();
  mocks.rpc.mockReset();
  mocks.profile.mockResolvedValue({
    id: crypto.randomUUID(),
    role: "DRIVER",
    is_active: true,
    approval_status: "APPROVED",
  });
  mocks.rpc.mockResolvedValue({ data: { items: [], unread: 0 }, error: null });
});
it("rejects unsigned or suspended accounts before fetching private history", async () => {
  mocks.profile.mockResolvedValue(null);
  expect((await GET(new Request(url))).status).toBe(401);
  mocks.profile.mockResolvedValue({
    role: "DRIVER",
    is_active: true,
    approval_status: "SUSPENDED",
  });
  expect((await GET(new Request(url))).status).toBe(401);
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it("keeps the feed private and refuses malformed pagination cursors", async () => {
  expect((await GET(new Request(url + "?before=-1"))).status).toBe(400);
  const response = await GET(new Request(url + "?before=200"));
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(mocks.rpc).toHaveBeenCalledWith("notification_feed", {
    p_before: 200,
  });
});
it("blocks cross-origin acknowledgements and invalid broad read requests", async () => {
  expect(
    (await post({ ids: [], all: true, through: 10 }, "https://evil.example"))
      .status,
  ).toBe(403);
  for (const body of [
    { ids: [], all: true },
    { ids: ["malformed"], all: false },
    { ids: [], all: "true" },
    { ids: Array(201).fill(crypto.randomUUID()), all: false },
  ])
    expect((await post(body)).status).toBe(400);
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it("acknowledges only validated IDs or the explicitly observed all-read cutoff", async () => {
  const id = crypto.randomUUID();
  expect((await post({ ids: [id], all: false })).status).toBe(200);
  expect(mocks.rpc).toHaveBeenLastCalledWith("notification_read", {
    p_ids: [id],
    p_all: false,
    p_through: null,
  });
  expect((await post({ ids: [], all: true, through: 42 })).status).toBe(200);
  expect(mocks.rpc).toHaveBeenLastCalledWith("notification_read", {
    p_ids: [],
    p_all: true,
    p_through: 42,
  });
});
it("preserves authorization failures without exposing database error details", async () => {
  mocks.rpc.mockResolvedValue({
    error: { code: "42501", message: "Private database details" },
  });
  const response = await post({ ids: [crypto.randomUUID()], all: false });
  expect(response.status).toBe(403);
  expect(await response.text()).not.toContain("Private database details");
});
