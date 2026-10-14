"use server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { supabaseConfig } from "@/lib/supabase/env";
import { readCurrentProfile } from "@/data-access/profiles";
import { accountHome } from "@/domain/auth/roles";
import { cookies } from "next/headers";
export type SignInState = { error: string } | null;
export async function signIn(
  _previous: SignInState,
  form: FormData,
): Promise<SignInState> {
  if (!supabaseConfig())
    return { error: "Sign-in is unavailable until Supabase is configured." };
  const email = form.get("email"),
    password = form.get("password");
  if (
    typeof email !== "string" ||
    typeof password !== "string" ||
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ||
    password.length < 1 ||
    password.length > 256
  )
    return { error: "Enter a valid email and password." };
  const client = await createClient();
  const { error } = await client.auth.signInWithPassword({
    email: email.trim(),
    password,
  });
  if (error)
    return {
      error: "Unable to sign in. Check your credentials or try again later.",
    };
  const profile = await readCurrentProfile();
  if (profile?.role === "ADMIN" && !profile.is_active) {
    await client.auth.signOut();
    return {
      error: "Account access is unavailable. Contact your administrator.",
    };
  }
  redirect(accountHome(profile));
}
export async function signOut() {
  let clearedWithWarning = false;
  try {
    if (supabaseConfig()) {
      const client = await createClient();
      const { error } = await client.auth.signOut({ scope: "local" });
      if (error) {
        // Installed Auth SDK may remove the local session even on provider errors.
        // getSession here only inspects logout state; it never grants permissions.
        const {
          data: { session },
        } = await client.auth.getSession();
        if (session) return { error: "Could not sign out. Please try again." };
        clearedWithWarning = true;
      }
    }
  } catch {
    return { error: "Could not sign out. Please try again." };
  }
  (await cookies()).delete("mk-driver-device");
  redirect(clearedWithWarning ? "/sign-in?reason=signout" : "/sign-in");
}
