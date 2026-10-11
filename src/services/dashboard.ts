import "server-only";
import { requirePermission } from "./auth";
import { readActiveBusinessDay } from "@/data-access/business-days";
import { readInventory } from "@/data-access/inventory";
import { readOperations } from "@/data-access/operations";
import { readFinance } from "@/data-access/finance";
import { readDayHistory, readDayReport } from "@/data-access/day-reports";
export async function getAdminDashboard() {
  await requirePermission("admin:read");
  const [businessDay, inventory, operations, finance, history] =
    await Promise.all([
      readActiveBusinessDay(),
      readInventory(),
      readOperations(),
      readFinance(),
      readDayHistory(),
    ]);
  const dayDetail =
    businessDay && history.available
      ? await readDayReport(businessDay.id)
      : null;
  return { businessDay, inventory, operations, finance, dayDetail };
}
