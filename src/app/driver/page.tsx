import { redirect } from "next/navigation";
import { requirePermission } from "@/services/auth";
export default async function Driver() {
  await requirePermission("driver:read");
  redirect("/driver/home");
}
