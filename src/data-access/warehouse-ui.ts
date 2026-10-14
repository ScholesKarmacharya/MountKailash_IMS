import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Balance } from "./inventory";
import type {
  HistoryFilter,
  MovementRecord,
} from "@/domain/inventory/presentation";
import {
  canonicalRange,
  EPOCH_AD_ISO,
  MAX_AD_ISO,
} from "@/domain/localization/calendar";

const movementSelect =
  "*,product:products(name,sku,unit),actor:profiles!stock_movements_actor_user_id_fkey(name),from_location:stock_locations!stock_movements_from_location_id_fkey(name,kind,code),to_location:stock_locations!stock_movements_to_location_id_fkey(name,kind,code),business_day:business_days!stock_movements_business_day_id_fkey(date_label),trip:trips!stock_movements_trip_id_fkey(trip_number),processing:warehouse_processing!stock_movements_processing_id_fkey(reason,operation)";
const fail = () =>
  new Error("Inventory could not be loaded. Please try again.");
export async function readWarehouseActivity(filter: HistoryFilter) {
  const client = await createClient();
  let query = client.from("stock_movements").select(movementSelect);
  if (filter.scope === "warehouse") {
    const location = await client
      .from("stock_locations")
      .select("id")
      .eq("code", "MAIN")
      .eq("kind", "WAREHOUSE")
      .single();
    if (location.error || !location.data) throw fail();
    query = query.or(
      `from_location_id.eq.${location.data.id},to_location_id.eq.${location.data.id}`,
    );
  }
  if (filter.from || filter.to) {
    const range = canonicalRange(
      filter.from || EPOCH_AD_ISO,
      filter.to || MAX_AD_ISO,
    );
    query = query.gte("created_at", range.start).lt("created_at", range.end);
  }
  if (filter.product) query = query.eq("product_id", filter.product);
  if (filter.state) query = query.eq("stock_kind", filter.state);
  if (filter.type) query = query.eq("movement_type", filter.type);
  // Atomic completed refills have two journal legs. Page one representative
  // per batch, then fetch its original legs. Empty-state/input filters use
  // the input leg instead; grouping never changes or totals journal records.
  if (!filter.type && filter.state !== "EMPTY_JAR")
    query = query.neq("movement_type", "REFILL_INPUT");
  const result = await query
    .order("created_at", { ascending: false })
    .order("id")
    .range(filter.page * 25, filter.page * 25 + 25);
  if (result.error || !result.data) throw fail();
  const rows = result.data.slice(0, 25) as MovementRecord[];
  const ids = [
    ...new Set(
      rows.map((r) => r.processing_id).filter((id): id is string => !!id),
    ),
  ];
  const related = ids.length
    ? await client
        .from("stock_movements")
        .select(movementSelect)
        .in("processing_id", ids)
        .order("line_number")
    : { data: [], error: null };
  if (related.error || !related.data) throw fail();
  return {
    rows,
    related: related.data as MovementRecord[],
    hasMore: result.data.length > 25,
  };
}
export async function readDamagedStock() {
  const client = await createClient();
  const location = await client
    .from("stock_locations")
    .select("id")
    .eq("code", "DAMAGED")
    .eq("kind", "DAMAGE")
    .maybeSingle();
  if (location.error) throw fail();
  if (!location.data) return { tracked: false, balances: [] as Balance[] };
  const balances: Balance[] = [];
  for (let offset = 0; ; offset += 500) {
    const result = await client
      .from("inventory_balances")
      .select("product_id,stock_kind,quantity")
      .eq("location_id", location.data.id)
      .order("product_id")
      .order("stock_kind")
      .range(offset, offset + 499);
    if (result.error || !result.data) throw fail();
    balances.push(...(result.data as Balance[]));
    if (result.data.length < 500) return { tracked: true, balances };
  }
}
export type ProcessingRecord = {
  id: string;
  product_id: string;
  actor_user_id: string;
  business_day_id: string;
  operation: "REFILL" | "DAMAGE";
  stock_kind: "FULL_JAR" | "EMPTY_JAR";
  quantity: number;
  reason: string;
  created_at: string;
  request_key: string;
  product: { name: string; unit: string };
  actor: { name: string };
  business_days: { date_label: string };
  movements: MovementRecord[];
};
export async function readProcessingHistory(filter: HistoryFilter) {
  const client = await createClient();
  let query = client
    .from("warehouse_processing")
    .select(
      "*,product:products(name,unit),actor:profiles!warehouse_processing_actor_user_id_fkey(name),business_days!inner(date_label),movements:stock_movements(*)",
    );
  // Preserve the existing history's posting-business-date semantics, including
  // processing recorded after midnight against an open previous day.
  if (filter.from) query = query.gte("business_days.date_label", filter.from);
  if (filter.to) query = query.lte("business_days.date_label", filter.to);
  if (filter.product) query = query.eq("product_id", filter.product);
  if (filter.state) query = query.eq("stock_kind", filter.state);
  const result = await query
    .order("created_at", { ascending: false })
    .order("id")
    .range(filter.page * 25, filter.page * 25 + 25);
  if (
    result.error &&
    ["42P01", "PGRST205", "PGRST200"].includes(result.error.code)
  )
    return { available: false, rows: [] as ProcessingRecord[], hasMore: false };
  if (result.error || !result.data) throw fail();
  return {
    available: true,
    rows: result.data.slice(0, 25) as ProcessingRecord[],
    hasMore: result.data.length > 25,
  };
}
