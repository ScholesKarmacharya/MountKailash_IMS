import {
  canonicalRange,
  EPOCH_AD_ISO,
  MAX_AD_ISO,
} from "@/domain/localization/calendar";
import { stockKinds, uuid, type StockKind } from "./validation";
import type { Balance } from "@/data-access/inventory";

export const movementLabels = {
  MANUAL_INCREASE: "Warehouse Stock Adjustment — Increase",
  MANUAL_DECREASE: "Warehouse Stock Adjustment — Decrease",
  TRIP_LOAD: "Loaded onto Vehicle",
  TRIP_RETURN: "Returned to Warehouse",
  TRIP_UNLOAD: "Unloaded back to Warehouse",
  DELIVERY: "Delivered to Customer",
  EMPTY_COLLECTION: "Empty Jars Collected",
  VARIANCE_GAIN: "Stock Reconciliation — Increase",
  VARIANCE_LOSS: "Stock Reconciliation — Decrease",
  REFILL_INPUT: "Empty Jars Sent for Refilling",
  REFILL_OUTPUT: "Full Jars Added after Refilling",
  WAREHOUSE_DAMAGE: "Moved to Damaged Stock",
} as const;
export type HistoryFilter = {
  from: string;
  to: string;
  product: string;
  state: StockKind | "";
  type: string;
  scope: "warehouse" | "company";
  page: number;
};
export function inventoryHistoryFilter(
  params: Record<string, string | undefined>,
  prefix = "",
): HistoryFilter {
  const get = (key: string) => params[prefix + key] ?? "";
  const from = get("from"),
    to = get("to");
  if (from || to) canonicalRange(from || EPOCH_AD_ISO, to || MAX_AD_ISO);
  const product = get("product"),
    state = get("state"),
    type = get("type"),
    scope = get("scope") || "warehouse";
  if (product) uuid(product);
  if (state && !stockKinds.includes(state as StockKind))
    throw new Error("Invalid inventory history filters.");
  if (type && !Object.hasOwn(movementLabels, type))
    throw new Error("Invalid inventory history filters.");
  if (scope !== "warehouse" && scope !== "company")
    throw new Error("Invalid inventory history filters.");
  return {
    from,
    to,
    product,
    state: state as HistoryFilter["state"],
    type,
    scope,
    page: /^\d{1,4}$/.test(get("page")) ? Number(get("page")) : 0,
  };
}
export type MovementRecord = {
  id: string;
  product_id: string;
  stock_kind: StockKind;
  quantity: number;
  movement_type: string;
  created_at: string;
  actor_user_id: string;
  business_day_id: string;
  from_location_id: string | null;
  to_location_id: string | null;
  processing_id?: string | null;
  trip_id?: string | null;
  visit_id?: string | null;
  idempotency_key?: string;
  line_number?: number;
  from_quantity_before?: number | null;
  from_quantity_after?: number | null;
  to_quantity_before?: number | null;
  to_quantity_after?: number | null;
  product?: { name: string; sku: string; unit: string };
  actor?: { name: string };
  from_location?: { name: string; kind: string; code: string } | null;
  to_location?: { name: string; kind: string; code: string } | null;
  business_day?: { date_label: string };
  trip?: { trip_number: number } | null;
  processing?: { reason: string; operation: string } | null;
};
export function inventoryActivity(
  anchor: MovementRecord,
  related: MovementRecord[],
) {
  const batch = anchor.processing_id
    ? related.filter((m) => m.processing_id === anchor.processing_id)
    : [];
  const input = batch.find((m) => m.movement_type === "REFILL_INPUT");
  const output = batch.find((m) => m.movement_type === "REFILL_OUTPUT");
  const grouped =
    batch.length === 2 &&
    !!input &&
    !!output &&
    input.stock_kind === "EMPTY_JAR" &&
    output.stock_kind === "FULL_JAR" &&
    input.product_id === output.product_id &&
    input.quantity === output.quantity &&
    input.business_day_id === output.business_day_id &&
    input.actor_user_id === output.actor_user_id &&
    input.from_location_id === output.to_location_id &&
    !!input.from_location_id &&
    input.to_location_id === null &&
    output.from_location_id === null;
  return {
    anchor,
    label: grouped
      ? "Completed Refill"
      : (movementLabels[anchor.movement_type as keyof typeof movementLabels] ??
        "Stock Movement"),
    movements: grouped ? [input!, output!] : [anchor],
    grouped,
  };
}
export function availableStock(
  balances: Balance[],
  product: string,
  state: StockKind,
) {
  return balances
    .filter((b) => b.product_id === product && b.stock_kind === state)
    .reduce((sum, b) => sum + b.quantity, 0);
}
export function stockPreview(
  before: number,
  quantity: string,
  direction: "increase" | "decrease",
) {
  const amount = /^[1-9]\d{0,9}$/.test(quantity) ? Number(quantity) : 0;
  const after = before + amount * (direction === "increase" ? 1 : -1);
  return {
    amount,
    after,
    valid:
      amount > 0 && amount <= 1000000000 && after >= 0 && after <= 2147483647,
  };
}
