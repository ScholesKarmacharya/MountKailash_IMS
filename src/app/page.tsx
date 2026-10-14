import { redirect } from "next/navigation";
import { supabaseConfig } from "@/lib/supabase/env";
import { readCurrentProfile } from "@/data-access/profiles";
import { accountHome } from "@/domain/auth/roles";
import { cookies } from "next/headers";
export default async function Home() {
  if (!supabaseConfig()) redirect("/sign-in");
  const trusted = (await cookies()).get("mk-driver-device")?.value === "1";
  const profile = await readCurrentProfile().catch((error) => {
    if (trusted) return null;
    throw error;
  });
  // This cookie routes to a public shell only; it grants no server access.
  if (!profile && trusted) redirect("/driver/home");
  redirect(profile ? accountHome(profile) : "/sign-in");
}
