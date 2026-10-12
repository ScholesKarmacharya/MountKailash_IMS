import "server-only";
import { createClient } from "@/lib/supabase/server";
import { isRole, isApprovalStatus, type Profile } from "@/domain/auth/roles";
export async function readCurrentProfile(): Promise<Profile | null> {
  const client = await createClient();
  const {
    data: { user },
    error,
  } = await client.auth.getUser();
  if (error || !user) return null;
  const { data, error: profileError } = await client
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();
  if (profileError)
    throw new Error("Account access could not be checked. Please try again.");
  if (!data || !isRole(data.role)) return null;
  if (
    data.approval_status !== undefined &&
    !isApprovalStatus(data.approval_status)
  )
    throw new Error("Account access could not be checked. Please try again.");
  return {
    id: data.id,
    name: typeof data.name === "string" ? data.name : "",
    role: data.role,
    is_active: data.is_active,
    approval_status: data.approval_status,
    phone: data.phone,
    email: user.email,
    version: data.version,
    approved_at: data.approved_at,
  };
}
