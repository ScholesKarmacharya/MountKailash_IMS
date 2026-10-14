import "server-only";
import { requirePermission } from "./auth";
import {
  readWarehouseActivity,
  readDamagedStock,
  readProcessingHistory,
} from "@/data-access/warehouse-ui";
import { inventoryHistoryFilter } from "@/domain/inventory/presentation";
export async function getWarehouseActivity(
  params: Record<string, string | undefined>,
) {
  await requirePermission("admin:read");
  return readWarehouseActivity(inventoryHistoryFilter(params));
}
export async function getWarehouseDamage() {
  await requirePermission("admin:read");
  return readDamagedStock();
}
export async function getProcessingHistory(
  params: Record<string, string | undefined>,
) {
  await requirePermission("admin:read");
  return readProcessingHistory(inventoryHistoryFilter(params));
}
