import "server-only";
import { requirePermission } from "./auth";
import { readActiveBusinessDay } from "@/data-access/business-days";
import { readInventory } from "@/data-access/inventory";
import { readOperations } from "@/data-access/operations";
import { readFinance } from "@/data-access/finance";
export async function getAdminDashboard() {
  await requirePermission("admin:read");
  const [businessDay, inventory, operations, finance] = await Promise.all([
    readActiveBusinessDay(),
    readInventory(),
    readOperations(),
    readFinance(),
  ]);
  return { businessDay, inventory, operations, finance };
}
