import "server-only";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { supabaseConfig } from "@/lib/supabase/env";
import {
  isLocale,
  userLocale,
  type Locale,
} from "@/domain/localization/locale";
import type { Profile } from "@/domain/auth/roles";
export async function getLocale(profile?: Profile): Promise<Locale> {
  if (profile && supabaseConfig()) {
    const {
      data: { user },
    } = await (await createClient()).auth.getUser();
    return userLocale(user?.user_metadata?.locale, profile.role);
  }
  const value = (await cookies()).get("mk-locale")?.value;
  return isLocale(value) ? value : "en";
}
