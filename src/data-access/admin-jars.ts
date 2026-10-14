import "server-only";
import { createClient } from "@/lib/supabase/server";
import type {
  AdminJarWorkspace,
  JarHistory,
} from "@/domain/operations/admin-jars";
import type { DateRange } from "@/domain/localization/calendar";

export async function readAdminJars(
  month: DateRange,
): Promise<AdminJarWorkspace> {
  const { data, error } = await (
    await createClient()
  ).rpc("admin_jar_workspace", {
    p_month_start: month.start,
    p_month_end: month.end,
  });
  if (error) {
    if (["42P01", "PGRST202", "PGRST205"].includes(error.code))
      return {
        available: false,
        snapshot_at: "",
        month_start: month.start,
        month_end: month.end,
        customers: [],
        products: [],
        drivers: [],
      };
    throw new Error("Unreturned jars could not be loaded. Please retry.");
  }
  return { ...data, available: true } as AdminJarWorkspace;
}
export async function readAdminJarHistory(
  customer: string,
): Promise<JarHistory> {
  const { data, error } = await (
    await createClient()
  ).rpc("admin_jar_history", { p_customer: customer });
  if (error)
    throw new Error("Customer jar history could not be loaded. Please retry.");
  return data as JarHistory;
}
