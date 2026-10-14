import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Product, StockKind } from "@/domain/inventory/validation";
import type { DateRange } from "@/domain/localization/calendar";
export type Balance = {
  product_id: string;
  stock_kind: StockKind;
  quantity: number;
};
export type Adjustment = {
  id: string;
  stock_movement_id?: string;
  delta: number;
  reason: string;
  notes: string;
  quantity_before: number;
  quantity_after: number;
  created_at: string;
  stock_movements: {
    id?: string;
    idempotency_key?: string;
    [key: string]: unknown;
    product_id: string;
    stock_kind: StockKind;
    actor_user_id: string;
    business_day_id: string;
    from_location_id: string | null;
    to_location_id: string | null;
    profiles: { name: string } | null;
    business_days: { date_label: string } | null;
  };
};
export type InventorySnapshot = {
  available: boolean;
  products: Product[];
  balances: Balance[];
  adjustments: Adjustment[];
  hasMore: boolean;
};
export async function readProductIdentity(id: string) {
  const result = await (
    await createClient()
  )
    .from("products")
    .select("sku,kind,unit")
    .eq("id", id)
    .maybeSingle();
  if (result.error)
    throw new Error("Product could not be checked. Refresh and try again.");
  return result.data as Pick<Product, "sku" | "kind" | "unit"> | null;
}
async function readAll<T>(
  fetchPage: (
    offset: number,
  ) => PromiseLike<{ data: T[] | null; error: unknown }>,
) {
  const rows: T[] = [];
  for (let offset = 0; ; offset += 500) {
    const result = await fetchPage(offset);
    if (result.error || !result.data)
      throw new Error("Inventory could not be loaded. Please try again.");
    rows.push(...result.data);
    if (result.data.length < 500) return rows;
  }
}
export async function readInventory(
  page = 0,
  range?: DateRange,
  filters?: { product: string; state: StockKind | "" },
): Promise<InventorySnapshot> {
  const client = await createClient();
  const location = await client
    .from("stock_locations")
    .select("id")
    .eq("code", "MAIN")
    .eq("kind", "WAREHOUSE")
    .single();
  if (location.error) {
    if (["42P01", "PGRST205"].includes(location.error.code))
      return {
        available: false,
        products: [],
        balances: [],
        adjustments: [],
        hasMore: false,
      };
    throw new Error("Warehouse could not be loaded. Please try again.");
  }
  let adjustmentQuery = client
    .from("stock_adjustments")
    .select(
      "*,stock_movements!inner(*,profiles!stock_movements_actor_user_id_fkey(name),business_days!stock_movements_business_day_id_fkey(date_label))",
    )
    .order("created_at", { ascending: false })
    .order("id");
  if (range)
    adjustmentQuery = adjustmentQuery
      .gte("created_at", range.start)
      .lt("created_at", range.end);
  if (filters?.product)
    adjustmentQuery = adjustmentQuery.eq(
      "stock_movements.product_id",
      filters.product,
    );
  if (filters?.state)
    adjustmentQuery = adjustmentQuery.eq(
      "stock_movements.stock_kind",
      filters.state,
    );
  const [products, balances, adjustments] = await Promise.all([
    readAll<
      Omit<Product, "default_price"> & { default_price: string | number }
    >((offset) =>
      client
        .from("products")
        .select("id,sku,name,kind,unit,default_price,is_active,version")
        .order("id")
        .range(offset, offset + 499),
    ),
    readAll<Balance>((offset) =>
      client
        .from("inventory_balances")
        .select("product_id,stock_kind,quantity")
        .eq("location_id", location.data.id)
        .order("product_id")
        .order("stock_kind")
        .range(offset, offset + 499),
    ),
    adjustmentQuery.range(page * 25, page * 25 + 25),
  ]);
  if (adjustments.error)
    throw new Error("Inventory could not be loaded. Please try again.");
  // NUMERIC is transported as a display string; never do price arithmetic in JS.
  return {
    available: true,
    products: products
      .map((p) => ({
        ...p,
        default_price: String(p.default_price),
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    balances,
    adjustments: adjustments.data.slice(0, 25) as unknown as Adjustment[],
    hasMore: adjustments.data.length > 25,
  };
}
export async function inventoryRpc(
  name: string,
  args: Record<string, unknown>,
) {
  const client = await createClient();
  const { data, error } = await client.rpc(name, args);
  if (error) {
    const safeMessages = [
      "Insufficient stock; balance cannot be negative.",
      "An OPEN business day is required.",
      "Product changed; reload before saving.",
      "Idempotency key already used for a different request.",
      "Product kind cannot change after creation.",
      "Stock state does not match product.",
      "A business day is already active.",
      "Stock quantity exceeds supported range.",
    ];
    if (safeMessages.includes(error.message)) throw new Error(error.message);
    if (error.code === "23505")
      throw new Error(
        "This SKU or record already exists. Reload and check before retrying.",
      );
    if (["PGRST202", "PGRST205", "42P01"].includes(error.code))
      throw new Error("Sprint 1 migration must be applied before saving.");
    throw new Error(
      "Unable to save. Check your access and try again with the same request.",
    );
  }
  return data as string;
}
