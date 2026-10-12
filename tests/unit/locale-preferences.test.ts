import { beforeEach, describe, it, expect, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  guard: vi.fn(),
  update: vi.fn(),
  cookie: vi.fn(),
  client: vi.fn(),
}));
vi.mock("@/services/auth", () => ({ requireIdentity: mocks.guard }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.client }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ set: mocks.cookie }),
}));
import { POST } from "@/app/api/preferences/route";
const request = (data: unknown, origin = "http://127.0.0.1:3002") =>
  new Request("http://localhost:3002/api/preferences", {
    method: "POST",
    headers: {
      host: "127.0.0.1:3002",
      origin,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  });
describe("per-user locale storage is separate from permissions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.guard.mockResolvedValue({ id: "caller", role: "DRIVER" });
    mocks.client.mockResolvedValue({ auth: { updateUser: mocks.update } });
    mocks.update.mockResolvedValue({ error: null });
  });
  it("accepts the requested host and only writes locale to the authenticated account", async () => {
    const response = await POST(
      request({ locale: "ne", role: "ADMIN", id: "other-user" }),
    );
    expect(response.status).toBe(200);
    expect(mocks.guard).toHaveBeenCalledWith();
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith({
      data: { locale: "ne" },
    });
    expect(mocks.cookie).toHaveBeenCalledWith(
      "mk-locale",
      "ne",
      expect.objectContaining({ sameSite: "lax", path: "/" }),
    );
  });
  it("rejects cross-origin changes before authentication or writes", async () => {
    expect(
      (await POST(request({ locale: "ne" }, "https://attacker.example")))
        .status,
    ).toBe(403);
    expect(mocks.guard).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it.each(["ADMIN", "fr", null, {}, 0])(
    "rejects invalid locale %j",
    async (locale) => {
      expect((await POST(request({ locale }))).status).toBe(400);
      expect(mocks.update).not.toHaveBeenCalled();
    },
  );
  it("requires verified identity, including pending accounts, before updating display metadata", async () => {
    mocks.guard.mockRejectedValue(new Error("Forbidden"));
    await expect(POST(request({ locale: "en" }))).rejects.toThrow("Forbidden");
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("does not report persistence or expose diagnostics on a provider failure", async () => {
    mocks.update.mockResolvedValue({
      error: { message: "PRIVATE_PROVIDER_DIAGNOSTIC" },
    });
    const response = await POST(request({ locale: "en" }));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ saved: false });
    expect(mocks.cookie).not.toHaveBeenCalled();
  });
});
