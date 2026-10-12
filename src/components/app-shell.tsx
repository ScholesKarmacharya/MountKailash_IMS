import { T, Message } from "@/components/localization";
import { Droplets } from "lucide-react";
import type { Profile } from "@/domain/auth/roles";
import { signOut } from "@/app/sign-in/actions";
import { Button } from "./ui/button";
import { Navigation } from "./navigation";
import { cn } from "@/lib/utils";
import { OperationFeedback } from "./operation-feedback";
import { LocaleProvider, LanguageSwitcher } from "./localization";
import { getLocale } from "@/lib/i18n/server";
export async function AppShell({
  profile,
  children,
}: {
  profile: Profile;
  children: React.ReactNode;
}) {
  const locale = await getLocale(profile);
  return (
    <LocaleProvider key={profile.id} initialLocale={locale} userId={profile.id}>
      <div
        className={cn(
          "min-h-dvh",
          profile.role === "ADMIN" && "lg:grid lg:grid-cols-[250px_1fr]",
        )}
      >
        <OperationFeedback />
        <aside
          className={cn(
            "border-b border-border bg-card p-5",
            profile.role === "ADMIN"
              ? "lg:sticky lg:top-0 lg:h-dvh lg:overflow-y-auto lg:border-r"
              : "space-y-4",
          )}
        >
          <div
            className={cn(
              "flex items-center gap-3",
              profile.role === "ADMIN" && "mb-7",
            )}
          >
            <Droplets className="size-8 text-primary" aria-hidden="true" />
            <div>
              <p className="font-bold">
                <T k="Mount Kailash" />
              </p>
              <p className="text-xs text-muted-foreground">
                <Message
                  value={
                    profile.role === "ADMIN"
                      ? "Warehouse administration"
                      : "Delivery workspace"
                  }
                />
              </p>
            </div>
          </div>
          <Navigation role={profile.role} />
        </aside>
        <div className="min-w-0">
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-card px-6 py-4">
            <span className="rounded-full bg-muted px-3 py-1 text-xs font-semibold">
              <T k="Operations workspace" />
            </span>
            <div className="flex items-center gap-4">
              <LanguageSwitcher />
              <span className="text-sm">{profile.name}</span>
              <form action={signOut}>
                <Button variant="outline" type="submit">
                  <T k="Sign out" />
                </Button>
              </form>
            </div>
          </header>
          <main
            id="main-content"
            className={cn(
              "mx-auto max-w-7xl p-5 sm:p-8 lg:p-10",
              profile.role === "DRIVER" && "pb-44 sm:pb-44 lg:pb-10",
            )}
          >
            {children}
          </main>
          <footer className="px-8 py-5 text-xs text-muted-foreground">
            <T k="Asia/Kathmandu · Business days close manually" />
          </footer>
        </div>
      </div>
    </LocaleProvider>
  );
}
