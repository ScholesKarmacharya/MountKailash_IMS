import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { DayDetail, HistoryDay } from "@/domain/business-days/types";
import { readProductDeliveries, readProductKinds } from "./product-deliveries";
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
  if (!data) return null;
  const detail = data as DayDetail;
  const products = await readProductKinds(
    client,
    detail.report.products.map((p) => p.product_id),
  );
  const items = await readProductDeliveries(
    client,
    detail.report.customers.map((c) => c.id),
  );
  // Enrich the display only. Stored closed-day archives and all monetary
  // snapshots remain untouched; product kinds and visit quantities are immutable.
  detail.report.products = detail.report.products.map((p) => ({
    ...p,
    kind: products.find((product) => product.id === p.product_id)?.kind,
  }));
  detail.report.customers = detail.report.customers.map((c) => ({
    ...c,
    items: items
      .filter((i) => i.visit_id === c.id)
      .map((i) => ({
        ...i,
        name:
          detail.report.products.find((p) => p.product_id === i.product_id)
            ?.name ?? i.name,
      })),
  }));
  return detail;
}
