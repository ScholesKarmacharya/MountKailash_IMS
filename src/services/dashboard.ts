import "server-only";
import { requirePermission } from "./auth";
import { readActiveBusinessDay } from "@/data-access/business-days";
import { readInventory } from "@/data-access/inventory";
import { readOperations } from "@/data-access/operations";
export async function getAdminDashboard() {
  await requirePermission("admin:read");
  const [businessDay, inventory, operations] = await Promise.all([
    readActiveBusinessDay(),
    readInventory(),
    readOperations(),
  ]);
  return { businessDay, inventory, operations };
}
