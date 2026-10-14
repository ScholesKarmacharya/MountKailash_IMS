import "server-only";
import { createClient } from "@/lib/supabase/server";
import { isRole, isApprovalStatus, type Profile } from "@/domain/auth/roles";
import { ProfileAccessError } from "@/domain/auth/access-errors";
export async function readCurrentProfile(): Promise<Profile | null> {
  const client = await createClient();
  const {
    data: { user },
    error,
  } = await client.auth.getUser();
  if (error) {
    if (error.name === "AuthRetryableFetchError" || error.status === 0)
      throw new ProfileAccessError(
        error.status === 0 ? "NETWORK" : "TEMPORARY",
      );
    if (
      error.status &&
      error.status !== 400 &&
      error.status !== 401 &&
      error.status !== 403
    )
      throw new ProfileAccessError("TEMPORARY");
    return null;
  }
  if (!user) return null;
  const { data, error: profileError } = await client
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();
  if (profileError)
    throw new ProfileAccessError(
      ["42P01", "42703", "PGRST205", "PGRST204"].includes(profileError.code)
        ? "SCHEMA"
        : /fetch failed|Failed to fetch|network/i.test(profileError.message)
          ? "NETWORK"
          : "TEMPORARY",
    );
  if (!data || !isRole(data.role)) return null;
  if (
    data.approval_status !== undefined &&
    !isApprovalStatus(data.approval_status)
  )
    throw new ProfileAccessError("SCHEMA");
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
