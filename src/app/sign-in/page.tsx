import { T } from "@/components/localization";
import { Droplets, ShieldCheck } from "lucide-react";
import { Card } from "@/components/ui/card";
import { supabaseConfig } from "@/lib/supabase/env";
import { readCurrentProfile } from "@/data-access/profiles";
import { homeFor } from "@/domain/auth/roles";
import { redirect } from "next/navigation";
import { SignInForm } from "./sign-in-form";
import { LanguageSwitcher } from "@/components/localization";
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const configured = !!supabaseConfig();
  if (configured) {
    const profile = await readCurrentProfile();
    if (profile?.is_active) redirect(homeFor(profile.role));
  }
  const { reason } = await searchParams;
  return (
    <main id="main-content" className="grid min-h-dvh lg:grid-cols-2">
      <section className="flex flex-col justify-between bg-[#12394a] p-8 text-white lg:p-16">
        <div className="flex items-center gap-3">
          <Droplets aria-hidden="true" className="size-9 text-teal-300" />
          <div>
            <p className="text-xl font-bold">
              <T k="Mount Kailash" />
            </p>
            <p className="text-sm text-slate-300">
              <T k="Water distribution" />
            </p>
          </div>
        </div>
        <div className="py-12">
          <p className="mb-4 text-xs font-semibold uppercase tracking-[.2em] text-teal-300">
            <T k="Operations workspace" />
          </p>
          <h1 className="max-w-lg text-4xl font-bold leading-tight lg:text-5xl">
            <T k="A clear view of every delivery." />
          </h1>
          <p className="mt-6 max-w-md leading-relaxed text-slate-300">
            <T k="One workspace for your warehouse and delivery team. Sign in to access your assigned role." />
          </p>
        </div>
        <p className="text-xs text-slate-300">
          <T k="Mount Kailash operations · Nepal business time" />
        </p>
      </section>
      <section className="flex items-center justify-center p-6 lg:p-12">
        <Card className="w-full max-w-md p-8">
          <div className="mb-4 flex justify-end">
            <LanguageSwitcher />
          </div>
          <ShieldCheck
            className="mb-6 size-8 text-primary"
            aria-hidden="true"
          />
          <h2 className="text-2xl font-bold">
            <T k="Welcome back" />
          </h2>
          <p className="mb-7 mt-2 text-sm text-muted-foreground">
            <T k="Sign in to your operations account." />
          </p>
          {!configured && (
            <p
              role="status"
              className="mb-5 rounded-lg bg-amber-50 p-3 text-sm text-amber-900"
            >
              <T k="Setup required: configure local Supabase environment variables. Authentication is not yet connected." />
            </p>
          )}
          {configured && reason === "access" && (
            <p role="alert" className="mb-5 text-sm text-red-800">
              <T k="Your session or account access is unavailable. Contact your administrator if this continues." />
            </p>
          )}
          <SignInForm configured={configured} />
        </Card>
      </section>
    </main>
  );
}
