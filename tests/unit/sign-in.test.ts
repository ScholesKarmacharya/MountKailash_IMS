import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  configured: vi.fn(),
  password: vi.fn(),
  signOut: vi.fn(),
  session: vi.fn(),
  profile: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/supabase/env", () => ({ supabaseConfig: mocks.configured }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      signInWithPassword: mocks.password,
      signOut: mocks.signOut,
      getSession: mocks.session,
    },
  }),
}));
vi.mock("@/data-access/profiles", () => ({
  readCurrentProfile: mocks.profile,
}));
import { signIn, signOut } from "@/app/sign-in/actions";
const form = () => {
  const data = new FormData();
  data.set("email", "driver@test.example");
  data.set("password", "test-only-password");
  return data;
};
describe("server authentication actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.configured.mockReturnValue({ url: "local", key: "public" });
    mocks.password.mockResolvedValue({ error: null });
    mocks.signOut.mockResolvedValue({ error: null });
    mocks.session.mockResolvedValue({
      data: { session: { access_token: "fixture" } },
      error: null,
    });
  });
  it("fails closed without environment settings", async () => {
    mocks.configured.mockReturnValue(null);
    expect((await signIn(null, form()))?.error).toContain("unavailable");
    expect(mocks.password).not.toHaveBeenCalled();
  });
  it("validates submitted fields before contacting auth", async () => {
    const data = form();
    data.set("email", "invalid");
    expect((await signIn(null, data))?.error).toContain("valid email");
    expect(mocks.password).not.toHaveBeenCalled();
  });
  it("does not expose provider details on invalid login", async () => {
    mocks.password.mockResolvedValue({
      error: { message: "internal provider details" },
    });
    const result = await signIn(null, form());
    expect(result?.error).toContain("Unable to sign in");
    expect(result?.error).not.toContain("provider details");
    expect(mocks.profile).not.toHaveBeenCalled();
  });
  it("clears session when profile is disabled", async () => {
    mocks.profile.mockResolvedValue({ role: "ADMIN", is_active: false });
    expect((await signIn(null, form()))?.error).toContain("Account access");
    expect(mocks.signOut).toHaveBeenCalledOnce();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
  it.each(["ADMIN", "DRIVER"])(
    "redirects authenticated %s using database role",
    async (role) => {
      mocks.profile.mockResolvedValue({ role, is_active: true });
      await expect(signIn(null, form())).rejects.toThrow(
        `REDIRECT:${role === "ADMIN" ? "/admin/dashboard" : "/driver/home"}`,
      );
    },
  );
  it("sign-out redirects only after the provider clears the session", async () => {
    await expect(signOut()).rejects.toThrow("REDIRECT:/sign-in");
    expect(mocks.signOut).toHaveBeenCalledOnce();
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: "local" });
  });
  it.each(["PENDING", "REJECTED", "SUSPENDED"])(
    "keeps %s authenticated for the waiting page without operational access",
    async (status) => {
      mocks.profile.mockResolvedValue({
        role: "DRIVER",
        is_active: false,
        approval_status: status,
      });
      await expect(signIn(null, form())).rejects.toThrow("REDIRECT:/account");
      expect(mocks.signOut).not.toHaveBeenCalled();
    },
  );
  it("routes a verified profile-less account to pending profile completion", async () => {
    mocks.profile.mockResolvedValue(null);
    await expect(signIn(null, form())).rejects.toThrow("REDIRECT:/account");
  });
  it("returns a safe retry message and does not redirect when sign-out fails", async () => {
    mocks.signOut.mockResolvedValue({
      error: { message: "private provider diagnostic" },
    });
    expect(await signOut()).toEqual({
      error: "Could not sign out. Please try again.",
    });
    expect(mocks.redirect).not.toHaveBeenCalled();
    mocks.signOut.mockRejectedValue(new Error("private network failure"));
    expect(await signOut()).toEqual({
      error: "Could not sign out. Please try again.",
    });
  });
  it("redirects with a friendly warning when the SDK has already cleared the session on error", async () => {
    mocks.signOut.mockResolvedValue({
      error: { message: "private provider diagnostic" },
    });
    mocks.session.mockResolvedValue({ data: { session: null }, error: null });
    await expect(signOut()).rejects.toThrow("REDIRECT:/sign-in?reason=signout");
  });
});
