import Link from "next/link";
import { T } from "@/components/localization";
import { Droplets, UserRound } from "lucide-react";
import { approvalLabels, type Profile } from "@/domain/auth/roles";
import { Navigation } from "./navigation";
import { cn } from "@/lib/utils";
import { OperationFeedback } from "./operation-feedback";
import { LocaleProvider, LanguageSwitcher, Message } from "./localization";
import { getLocale } from "@/lib/i18n/server";
import { SignOutButton } from "./sign-out-button";
import { Button } from "./ui/button";
import { OfflineDeviceBanner } from "./offline/banner";
import { DriverApplication } from "./driver-application";
import { NotificationBell } from "./notification-bell";
export async function AppShell({
  profile,
  children,
}: {
  profile: Profile;
  children: React.ReactNode;
}) {
  const locale = await getLocale(profile),
    driver = profile.role === "DRIVER";
  if (driver)
    return (
      <DriverApplication profile={profile} locale={locale}>
        {children}
      </DriverApplication>
    );
  const roleLabel = driver ? "Delivery Driver" : "Warehouse Admin";
  const brand = (
    <div className="flex min-w-0 items-center gap-2">
      <Droplets className="size-7 shrink-0 text-primary" aria-hidden="true" />
      <div className="min-w-0">
        <p className="font-bold">
          <T k="Mount Kailash" />
        </p>
        <p className="text-xs text-muted-foreground">
          <Message
            value={driver ? "Driver Workspace" : "Warehouse administration"}
          />
        </p>
      </div>
    </div>
  );
  return (
    <LocaleProvider key={profile.id} initialLocale={locale} userId={profile.id}>
      <div
        className={cn(
          "min-h-dvh",
          !driver && "lg:grid lg:grid-cols-[250px_1fr]",
        )}
      >
        <OperationFeedback />
        {!driver && (
          <aside className="border-b border-border bg-card p-5 lg:sticky lg:top-0 lg:h-dvh lg:overflow-auto lg:border-b-0 lg:border-r">
            <div className="mb-5">{brand}</div>
            <Navigation role={profile.role} />
          </aside>
        )}
        <div className="min-w-0">
          <header className="border-b border-border bg-card px-4 py-3 sm:px-6">
            <div
              className={cn(
                "mx-auto max-w-7xl items-center justify-between gap-x-3 gap-y-2",
                driver
                  ? "grid grid-cols-[minmax(0,1fr)_auto] sm:flex sm:flex-wrap"
                  : "flex flex-wrap",
              )}
            >
              {driver ? (
                brand
              ) : (
                <span className="rounded-full bg-muted px-3 py-1 text-xs font-semibold">
                  <T k="Operations workspace" />
                </span>
              )}
              <div
                className={cn(
                  "min-w-0 flex-wrap items-center gap-3",
                  driver ? "contents sm:flex" : "flex",
                )}
              >
                <Button
                  asChild
                  variant="ghost"
                  aria-label="My Profile"
                  className={cn(
                    "min-w-0 px-1 text-left",
                    driver && "col-start-1 row-start-2 justify-start",
                  )}
                >
                  <Link
                    href="/account/profile"
                    className="flex min-h-11 min-w-0 items-center gap-2 rounded-lg text-sm"
                  >
                    <UserRound
                      className="size-5 shrink-0 text-primary"
                      aria-hidden="true"
                    />
                    <div className="min-w-0">
                      <p
                        className="max-w-44 break-words font-semibold sm:max-w-64"
                        data-testid="profile-name"
                      >
                        {profile.name.trim() || <Message value={roleLabel} />}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        <Message value={roleLabel} />
                        {driver && profile.approval_status && (
                          <>
                            {" "}
                            ·{" "}
                            <Message
                              value={approvalLabels[profile.approval_status]}
                            />
                          </>
                        )}
                      </p>
                    </div>
                  </Link>
                </Button>
                <div
                  className={
                    driver
                      ? "col-start-2 row-start-1 justify-self-end"
                      : undefined
                  }
                >
                  <LanguageSwitcher />
                </div>
                <NotificationBell key={profile.id} profile={profile} />
                <div
                  className={
                    driver
                      ? "col-start-2 row-start-2 justify-self-end"
                      : undefined
                  }
                >
                  <SignOutButton user={profile.id} />
                </div>
              </div>
            </div>
            {driver && (
              <div className="mx-auto max-w-7xl lg:mt-3">
                <Navigation role={profile.role} />
              </div>
            )}
          </header>
          <main
            id="main-content"
            className={cn(
              "mx-auto max-w-7xl p-5 sm:p-8 lg:p-10",
              driver && "pb-44 sm:pb-44 lg:pb-10",
            )}
          >
            <OfflineDeviceBanner user={profile.id} driver={driver} />
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
