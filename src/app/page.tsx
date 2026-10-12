import { redirect } from "next/navigation";
import { supabaseConfig } from "@/lib/supabase/env";
import { readCurrentProfile } from "@/data-access/profiles";
import { accountHome } from "@/domain/auth/roles";
export default async function Home() {
  if (!supabaseConfig()) redirect("/sign-in");
  const profile = await readCurrentProfile();
  redirect(profile ? accountHome(profile) : "/sign-in");
}
