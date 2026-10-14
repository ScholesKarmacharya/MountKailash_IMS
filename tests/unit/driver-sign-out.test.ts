import { afterEach, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/env", () => ({
  supabaseConfig: () => ({ url: "https://fixture.supabase.co", key: "public" }),
}));
import { clearDriverSessionCookies } from "@/lib/offline/sign-out";
afterEach(() => vi.unstubAllGlobals());
it("removes only the installed SDK's own auth and chunk cookies when offline", () => {
  const writes: string[] = [];
  const doc = {
    get cookie() {
      return "sb-fixture-auth-token.0=one; sb-fixture-auth-token.1=two; sb-fixture-auth-token-code-verifier=secret; preferences=en; sb-other-auth-token=other";
    },
    set cookie(value: string) {
      writes.push(value);
    },
  };
  vi.stubGlobal("document", doc);
  clearDriverSessionCookies();
  expect(writes).toHaveLength(3);
  expect(writes.every((w) => w.includes("Max-Age=0"))).toBe(true);
  expect(writes.join()).not.toContain("sb-other");
  expect(writes.join()).not.toContain("preferences");
});
