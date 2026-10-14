import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { DateRange } from "@/domain/localization/calendar";
import type { Trip } from "@/domain/operations/types";
import type { Workspace } from "@/domain/operations/types";
export async function readTripLoads(
  ids: string[],
): Promise<Workspace["loads"]> {
  if (!ids.length) return [];
  const client = await createClient(),
    rows: Workspace["loads"] = [];
  for (let start = 0; start < ids.length; start += 100) {
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await client
        .from("trip_load_items")
        .select("trip_id,product_id,stock_kind,quantity")
        .in("trip_id", ids.slice(start, start + 100))
        .order("trip_id")
        .order("product_id")
        .order("stock_kind")
        .range(offset, offset + 499);
      if (error)
        throw new Error("Trip loads could not be loaded. Please retry.");
      rows.push(...data);
      if (data.length < 500) break;
    }
  }
  return rows;
}
export type StockHistoryRow = {
  id: string;
  product_id: string;
  stock_kind: string;
  quantity: number;
  movement_type: string;
  created_at: string;
  actor_user_id: string;
  business_day_id: string;
  trip_id: string | null;
  from_location_id: string | null;
  to_location_id: string | null;
};
export async function readStockHistory(range?: DateRange, page = 0) {
  const client = await createClient();
  let query = client
    .from("stock_movements")
    .select(
      "id,product_id,stock_kind,quantity,movement_type,created_at,actor_user_id,business_day_id,trip_id,from_location_id,to_location_id",
    )
    .order("created_at", { ascending: false })
    .order("id");
  if (range)
    query = query.gte("created_at", range.start).lt("created_at", range.end);
  const { data, error } = await query.range(page * 25, page * 25 + 25);
  if (error)
    throw new Error("Inventory could not be loaded. Please try again.");
  return {
    rows: data.slice(0, 25) as StockHistoryRow[],
    hasMore: data.length > 25,
  };
}
export async function readTripHistory(range: DateRange): Promise<Trip[]> {
  const client = await createClient();
  const rows: Trip[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await client
      .from("trips")
      .select(
        "*,vehicles!inner(plate_number),profiles!trips_driver_id_fkey!inner(name),business_days!trips_business_day_id_fkey!inner(date_label)",
      )
      .gte("scheduled_date", range.from)
      .lte("scheduled_date", range.to)
      .order("created_at", { ascending: false })
      .order("id")
      .range(offset, offset + 499);
    if (error) throw new Error("Operations could not be loaded. Please retry.");
    for (const item of data)
      rows.push({
        ...item,
        plate_number: item.vehicles.plate_number,
        driver_name: item.profiles.name,
        date_label: item.scheduled_date,
        posting_date: item.business_days.date_label,
      } as Trip);
    if (data.length < 500) return rows;
  }
}
