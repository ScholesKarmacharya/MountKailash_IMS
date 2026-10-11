import "server-only";
import { requirePermission } from "./auth";
import { readActiveBusinessDay } from "@/data-access/business-days";
import { readInventory } from "@/data-access/inventory";
export async function getAdminDashboard() {
  await requirePermission("admin:read");
  const [businessDay, inventory] = await Promise.all([
    readActiveBusinessDay(),
    readInventory(),
  ]);
  return { businessDay, inventory };
}
