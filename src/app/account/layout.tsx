import Link from "next/link";
import { Droplets } from "lucide-react";
import { requireIdentity } from "@/services/auth";
import { readCurrentProfile } from "@/data-access/profiles";
import { getLocale } from "@/lib/i18n/server";
import { LocaleProvider, LanguageSwitcher, T } from "@/components/localization";
import { SignOutButton } from "@/components/sign-out-button";
export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireIdentity();
  const profile = await readCurrentProfile();
  const locale = await getLocale(
    profile ?? { id: user.id, name: "", role: "DRIVER", is_active: false },
  );
  return (
    <LocaleProvider key={user.id} initialLocale={locale} userId={user.id}>
      <div className="min-h-dvh">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-card p-4 sm:px-8">
          <Link
            href="/account"
            className="flex min-w-0 items-center gap-2 font-bold"
          >
            <Droplets className="size-7 shrink-0 text-primary" aria-hidden />
            <T k="Mount Kailash" />
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <LanguageSwitcher />
            <SignOutButton user={profile?.id} />
          </div>
        </header>
        <main
          id="main-content"
          className="mx-auto max-w-2xl space-y-6 p-5 sm:p-8"
        >
          {children}
        </main>
      </div>
    </LocaleProvider>
  );
}
