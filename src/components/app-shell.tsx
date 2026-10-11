import { Droplets } from "lucide-react";
import type { Profile } from "@/domain/auth/roles";
import { signOut } from "@/app/sign-in/actions";
import { Button } from "./ui/button";
import { Navigation } from "./navigation";
import { cn } from "@/lib/utils";
import { OperationFeedback } from "./operation-feedback";
export function AppShell({
  profile,
  children,
}: {
  profile: Profile;
  children: React.ReactNode;
}) {
  return (
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
            : "flex items-center justify-between gap-3",
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
            <p className="font-bold">Mount Kailash</p>
            <p className="text-xs text-muted-foreground">
              {profile.role === "ADMIN"
                ? "Warehouse administration"
                : "Delivery workspace"}
            </p>
          </div>
        </div>
        <Navigation role={profile.role} />
      </aside>
      <div className="min-w-0">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-card px-6 py-4">
          <span className="rounded-full bg-muted px-3 py-1 text-xs font-semibold">
            Operations workspace
          </span>
          <div className="flex items-center gap-4">
            <span className="text-sm">{profile.name}</span>
            <form action={signOut}>
              <Button variant="outline" type="submit">
                Sign out
              </Button>
            </form>
          </div>
        </header>
        <main
          id="main-content"
          className="mx-auto max-w-7xl p-5 sm:p-8 lg:p-10"
        >
          {children}
        </main>
        <footer className="px-8 py-5 text-xs text-muted-foreground">
          Asia/Kathmandu · Business days close manually
        </footer>
      </div>
    </div>
  );
}
