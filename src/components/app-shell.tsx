import Link from "next/link";
import { Droplets, UserRound } from "lucide-react";
import type { Profile } from "@/domain/auth/roles";
import { Navigation } from "./navigation";
import { OperationFeedback } from "./operation-feedback";
import { LocaleProvider, LanguageSwitcher, Message, T } from "./localization";
import { getLocale } from "@/lib/i18n/server";
import { SignOutButton } from "./sign-out-button";
import { Button } from "./ui/button";
import { DriverApplication } from "./driver-application";
import { NotificationBell } from "./notification-bell";
import { AdminMobileMenu } from "./admin-mobile-menu";
import { OfflineDeviceBanner } from "./offline/banner";
export async function AppShell({
  profile,
  children,
}: {
  profile: Profile;
  children: React.ReactNode;
}) {
  const locale = await getLocale(profile);
  if (profile.role === "DRIVER")
    return (
      <DriverApplication profile={profile} locale={locale}>
        {children}
      </DriverApplication>
    );
  return (
    <LocaleProvider key={profile.id} initialLocale={locale} userId={profile.id}>
      <div className="min-h-dvh lg:grid lg:grid-cols-[250px_1fr]">
        <OperationFeedback />
        <aside
          data-testid="admin-desktop-sidebar"
          className="hidden border-r border-border bg-card p-5 lg:sticky lg:top-0 lg:block lg:h-dvh lg:overflow-auto"
        >
          <div className="mb-5 flex items-center gap-2">
            <Droplets className="size-7 shrink-0 text-primary" aria-hidden />
            <div>
              <p className="font-bold">
                <T k="Mount Kailash" />
              </p>
              <p className="text-xs text-muted-foreground">
                <T k="Warehouse administration" />
              </p>
            </div>
          </div>
          <Navigation role="ADMIN" />
        </aside>
        <div className="min-w-0">
          <header
            data-testid="admin-navbar"
            className="sticky top-0 z-30 border-b border-border bg-card px-3 py-2 sm:px-6 lg:static lg:py-3"
          >
            <div className="mx-auto flex max-w-7xl items-center justify-between gap-1 sm:gap-3">
              <div className="flex min-w-0 items-center gap-1 sm:gap-2">
                <AdminMobileMenu profile={profile} />
                <Link
                  href="/admin/dashboard"
                  aria-label="Mount Kailash"
                  className="flex min-h-11 min-w-0 items-center gap-1 lg:hidden"
                >
                  <Droplets
                    className="size-5 shrink-0 text-primary"
                    aria-hidden
                  />
                  <span className="max-w-14 text-xs font-bold sm:max-w-none sm:text-sm">
                    <T k="Mount Kailash" />
                  </span>
                </Link>
                <span className="hidden rounded-full bg-muted px-3 py-1 text-xs font-semibold lg:block">
                  <T k="Operations workspace" />
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-1 sm:gap-3">
                <LanguageSwitcher compact />
                <NotificationBell key={profile.id} profile={profile} />
                <Button
                  asChild
                  variant="ghost"
                  aria-label="My Profile"
                  className="size-11 shrink-0 p-0 lg:h-auto lg:w-auto lg:px-1"
                >
                  <Link href="/account/profile">
                    <UserRound
                      className="size-5 shrink-0 text-primary"
                      aria-hidden
                    />
                    <div className="hidden min-w-0 text-left lg:block">
                      <p
                        data-testid="profile-name"
                        className="max-w-64 break-words font-semibold"
                      >
                        {profile.name.trim() || (
                          <Message value="Warehouse Admin" />
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        <T k="Warehouse Admin" />
                      </p>
                    </div>
                  </Link>
                </Button>
                <div className="hidden lg:block">
                  <SignOutButton user={profile.id} />
                </div>
              </div>
            </div>
          </header>
          <main
            id="main-content"
            className="mx-auto max-w-7xl p-4 sm:p-6 lg:p-10"
          >
            <OfflineDeviceBanner user={profile.id} driver={false} />
            {children}
          </main>
          <footer className="px-6 py-5 text-xs text-muted-foreground">
            <T k="Asia/Kathmandu · Business days close manually" />
          </footer>
        </div>
      </div>
    </LocaleProvider>
  );
}
