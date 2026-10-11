import "server-only";
import { createClient } from "@/lib/supabase/server";
import { isRole, type Profile } from "@/domain/auth/roles";
export async function readCurrentProfile(): Promise<Profile | null> {
  const client = await createClient();
  const {
    data: { user },
    error,
  } = await client.auth.getUser();
  if (error || !user) return null;
  const { data, error: profileError } = await client
    .from("profiles")
    .select("id,name,role,is_active")
    .eq("id", user.id)
    .maybeSingle();
  if (profileError)
    throw new Error("Account access could not be checked. Please try again.");
  if (!data || !isRole(data.role)) return null;
  return {
    id: data.id,
    name: data.name,
    role: data.role,
    is_active: data.is_active,
  };
}
