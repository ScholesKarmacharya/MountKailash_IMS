import { AppShell } from "@/components/app-shell";
import { requirePermission } from "@/services/auth";
export default async function DriverLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await requirePermission("driver:read");
  return <AppShell profile={profile}>{children}</AppShell>;
}
