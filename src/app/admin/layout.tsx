import { AppShell } from "@/components/app-shell";
import { requirePermission } from "@/services/auth";
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await requirePermission("admin:read");
  return <AppShell profile={profile}>{children}</AppShell>;
}
