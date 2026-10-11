import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { DayDetail, HistoryDay } from "@/domain/business-days/types";
export async function readDayHistory(
  from: string | null = null,
  to: string | null = null,
): Promise<{ available: boolean; days: HistoryDay[] }> {
  const client = await createClient();
  const { data, error } = await client.rpc("business_day_history", {
    p_from: from,
    p_to: to,
  });
  if (error) {
    if (["PGRST202", "PGRST205", "42P01"].includes(error.code))
      return { available: false, days: [] };
    throw new Error("Business-day history could not be loaded. Please retry.");
  }
  return { available: true, days: data as HistoryDay[] };
}
export async function readDayReport(id: string): Promise<DayDetail | null> {
  const client = await createClient();
  const { data, error } = await client.rpc("business_day_report", {
    p_day: id,
  });
  if (error) {
    if (["PGRST202", "PGRST205", "42P01", "22023"].includes(error.code))
      return null;
    throw new Error("Daily report could not be loaded. Please retry.");
  }
  return data as DayDetail;
}
