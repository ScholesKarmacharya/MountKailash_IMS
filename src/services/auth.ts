import "server-only";
import { redirect } from "next/navigation";
import { readCurrentProfile } from "@/data-access/profiles";
import { can, homeFor, type Permission } from "@/domain/auth/roles";
import { supabaseConfig } from "@/lib/supabase/env";
export async function requirePermission(permission: Permission) {
  if (!supabaseConfig()) redirect("/sign-in?reason=configuration");
  const profile = await readCurrentProfile();
  if (!profile?.is_active) redirect("/sign-in?reason=access");
  if (!can(profile, permission)) redirect(homeFor(profile.role));
  return profile;
}
