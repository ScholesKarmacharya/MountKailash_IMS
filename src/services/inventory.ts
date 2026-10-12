import "server-only";
import { requirePermission } from "./auth";
import { readInventory, inventoryRpc } from "@/data-access/inventory";
import { readActiveBusinessDay } from "@/data-access/business-days";
import type { DateRange } from "@/domain/localization/calendar";
import {
  parseAdjustment,
  parseProduct,
  uuid,
} from "@/domain/inventory/validation";
export async function getInventory(page = 0, range?: DateRange) {
  await requirePermission("admin:read");
  const [inventory, businessDay] = await Promise.all([
    range ? readInventory(page, range) : readInventory(page),
    readActiveBusinessDay(),
  ]);
  return { ...inventory, businessDay };
}
export async function saveProduct(form: FormData) {
  await requirePermission("product:manage");
  return inventoryRpc("save_product", parseProduct(form));
}
export async function adjustStock(form: FormData) {
  await requirePermission("stock:adjust");
  return inventoryRpc("adjust_warehouse_stock", parseAdjustment(form));
}
export async function openInventoryDay(form: FormData) {
  await requirePermission("day:open");
  return inventoryRpc("open_inventory_business_day", {
    p_key: uuid(String(form.get("key") ?? "")),
  });
}
