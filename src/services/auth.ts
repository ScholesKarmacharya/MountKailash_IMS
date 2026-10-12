import "server-only";
import { redirect } from "next/navigation";
import { readCurrentProfile } from "@/data-access/profiles";
import { can, homeFor, type Permission } from "@/domain/auth/roles";
import { supabaseConfig } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
export async function requireIdentity() {
  if (!supabaseConfig()) redirect("/sign-in?reason=configuration");
  const {
    data: { user },
    error,
  } = await (await createClient()).auth.getUser();
  if (error || !user) redirect("/sign-in");
  return user;
}
export async function requirePermission(permission: Permission) {
  if (!supabaseConfig()) redirect("/sign-in?reason=configuration");
  const profile = await readCurrentProfile();
  if (!profile || (profile.role === "DRIVER" && !can(profile, "driver:read")))
    redirect("/account");
  if (!profile.is_active) redirect("/sign-in?reason=access");
  if (!can(profile, permission)) redirect(homeFor(profile.role));
  return profile;
}
