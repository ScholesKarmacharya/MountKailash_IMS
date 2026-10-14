import { AppShell } from "@/components/app-shell";
import { requirePermission } from "@/services/auth";
import { readCurrentProfile } from "@/data-access/profiles";
import { DriverApplication } from "@/components/driver-application";
import { can } from "@/domain/auth/roles";
import { cookies } from "next/headers";
export default async function DriverLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // The public dashboard shell contains no server data. Authenticated APIs and
  // detail-page services still enforce permissions. An expired online session
  // must not prevent a trusted driver from unlocking the encrypted local copy.
  const current = await readCurrentProfile().catch(() => null);
  const trustedRoute = (await cookies()).get("mk-driver-device")?.value === "1";
  if (
    trustedRoute &&
    (!current || (current.role === "DRIVER" && !can(current, "driver:read")))
  )
    return <DriverApplication>{children}</DriverApplication>;
  const profile = await requirePermission("driver:read");
  return <AppShell profile={profile}>{children}</AppShell>;
}
