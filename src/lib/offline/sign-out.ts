import { supabaseConfig } from "@/lib/supabase/env";
// The installed @supabase/ssr client uses readable, root-path cookies, including
// chunk suffixes. Only this app's session is removed; business IndexedDB stays.
export function clearDriverSessionCookies() {
  const config = supabaseConfig();
  if (!config) return;
  const prefix = `sb-${new URL(config.url).hostname.split(".")[0]}-auth-token`;
  for (const cookie of document.cookie.split(";")) {
    const name = cookie.trim().split("=")[0]!;
    if (
      name === prefix ||
      name.startsWith(prefix + ".") ||
      name === prefix + "-code-verifier"
    )
      document.cookie = `${name}=; Path=/; Max-Age=0; SameSite=Lax`;
  }
}
