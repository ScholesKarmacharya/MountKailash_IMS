import { redirect } from "next/navigation";
import { requirePermission } from "@/services/auth";
export default async function Admin() {
  await requirePermission("admin:read");
  redirect("/admin/dashboard");
}
