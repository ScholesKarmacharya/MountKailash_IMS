import "server-only";
import { requirePermission } from "./auth";
import { readAdminJars, readAdminJarHistory } from "@/data-access/admin-jars";
import { presetRange } from "@/domain/localization/calendar";
import { uuid } from "@/domain/inventory/validation";

export async function getAdminJars() {
  await requirePermission("admin:read");
  return readAdminJars(presetRange("month"));
}
export async function getAdminJarHistory(customer: string) {
  await requirePermission("admin:read");
  return readAdminJarHistory(uuid(customer));
}
