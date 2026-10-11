export const stockKinds = ["FULL_JAR", "EMPTY_JAR", "BOTTLE_CARTON"] as const;
export type StockKind = (typeof stockKinds)[number];
export const stockLabels: Record<StockKind, string> = {
  FULL_JAR: "Full jars",
  EMPTY_JAR: "Empty jars",
  BOTTLE_CARTON: "Water cartons",
};
export type Product = {
  id: string;
  sku: string;
  name: string;
  kind: "FULL_JAR" | "BOTTLE_CARTON";
  unit: string;
  default_price: string;
  is_active: boolean;
  version: number;
};
function text(form: FormData, name: string) {
  const value = form.get(name);
  if (typeof value !== "string") throw new Error(`Missing ${name}.`);
  return value.trim();
}
export function uuid(value: string) {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
    throw new Error("Invalid record or request identifier.");
  return value;
}
function bounded(form: FormData, name: string, min: number, max: number) {
  const value = text(form, name);
  if (value.length < min || value.length > max)
    throw new Error(`${name} must contain ${min}–${max} characters.`);
  return value;
}
export function parseProduct(form: FormData) {
  const sku = text(form, "sku").toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9_-]{0,39}$/.test(sku))
    throw new Error(
      "SKU must use 1–40 letters, numbers, hyphens or underscores.",
    );
  const kind = text(form, "kind");
  if (kind !== "FULL_JAR" && kind !== "BOTTLE_CARTON")
    throw new Error("Choose a product kind.");
  const price = text(form, "price");
  if (!/^[0-9]{1,12}(\.[0-9]{1,2})?$/.test(price))
    throw new Error(
      "Price must be a nonnegative NPR amount with at most two decimals.",
    );
  const version = text(form, "version");
  if (!/^\d{1,9}$/.test(version)) throw new Error("Invalid product version.");
  const active = text(form, "active");
  if (active !== "true" && active !== "false")
    throw new Error("Invalid product status.");
  return {
    p_id: uuid(text(form, "id")),
    p_key: uuid(text(form, "key")),
    p_sku: sku,
    p_name: bounded(form, "name", 1, 120),
    p_kind: kind,
    p_unit: bounded(form, "unit", 1, 40),
    p_price: price,
    p_active: active === "true",
    p_version: Number(version),
    p_reason: bounded(form, "reason", 3, 500),
  };
}
export function parseAdjustment(form: FormData) {
  const kind = text(form, "kind");
  if (!stockKinds.includes(kind as StockKind))
    throw new Error("Choose a stock state.");
  const quantity = text(form, "quantity");
  if (!/^[1-9]\d{0,9}$/.test(quantity) || Number(quantity) > 1000000000)
    throw new Error("Quantity must be a whole number from 1 to 1,000,000,000.");
  const direction = text(form, "direction");
  if (direction !== "increase" && direction !== "decrease")
    throw new Error("Choose increase or decrease.");
  return {
    p_product: uuid(text(form, "product")),
    p_kind: kind as StockKind,
    p_delta: Number(quantity) * (direction === "increase" ? 1 : -1),
    p_reason: bounded(form, "reason", 3, 500),
    p_notes: bounded(form, "notes", 0, 2000),
    p_day: uuid(text(form, "day")),
    p_key: uuid(text(form, "key")),
  };
}
export function stockTotals(
  balances: { stock_kind: StockKind; quantity: number }[],
) {
  const totals: Record<StockKind, number> = {
    FULL_JAR: 0,
    EMPTY_JAR: 0,
    BOTTLE_CARTON: 0,
  };
  for (const balance of balances)
    totals[balance.stock_kind] += balance.quantity;
  return totals;
}
