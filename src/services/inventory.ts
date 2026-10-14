import "server-only";
import { requirePermission } from "./auth";
import {
  readInventory,
  inventoryRpc,
  readProductIdentity,
} from "@/data-access/inventory";
import { readActiveBusinessDay } from "@/data-access/business-days";
import type { DateRange } from "@/domain/localization/calendar";
import {
  parseAdjustment,
  parseProduct,
  uuid,
} from "@/domain/inventory/validation";
import type { HistoryFilter } from "@/domain/inventory/presentation";
export async function getInventory(
  page = 0,
  range?: DateRange,
  filters?: Pick<HistoryFilter, "product" | "state">,
) {
  await requirePermission("admin:read");
  const [inventory, businessDay] = await Promise.all([
    filters
      ? readInventory(page, range, filters)
      : range
        ? readInventory(page, range)
        : readInventory(page),
    readActiveBusinessDay(),
  ]);
  return { ...inventory, businessDay };
}
export async function saveProduct(form: FormData) {
  await requirePermission("product:manage");
  const args = parseProduct(form);
  const existing = await readProductIdentity(args.p_id);
  if (
    existing &&
    (existing.sku !== args.p_sku ||
      existing.kind !== args.p_kind ||
      existing.unit !== args.p_unit)
  )
    throw new Error(
      "SKU, product kind and unit are fixed to protect stock and transaction history.",
    );
  return inventoryRpc("save_product", args);
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
