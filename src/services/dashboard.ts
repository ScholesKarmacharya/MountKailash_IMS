import "server-only";
import { requirePermission } from "./auth";
import { readActiveBusinessDay } from "@/data-access/business-days";
export async function getAdminDashboard() {
  await requirePermission("admin:read");
  return { businessDay: await readActiveBusinessDay() };
}
