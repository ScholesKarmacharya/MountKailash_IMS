import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { DriverAccount } from "@/domain/auth/accounts";
import type { Command } from "@/domain/operations/commands";
export type DriverAudit = {
  id: string;
  action: string;
  reason: string;
  created_at: string;
  actor: { name: string } | null;
  before_json: unknown;
  after_json: unknown;
  actor_user_id: string;
  entity_id: string;
};
export async function readDriverAudit(id: string, page = 0) {
  const { data, error } = await (
    await createClient()
  )
    .from("audit_events")
    .select("*,actor:profiles!audit_events_actor_user_id_fkey(name)")
    .eq("entity", "profiles")
    .eq("entity_id", id)
    .order("created_at", { ascending: false })
    .order("id")
    .range(page * 25, page * 25 + 25);
  if (error)
    throw new Error("Driver audit history could not be loaded. Please retry.");
  return {
    rows: data.slice(0, 25) as unknown as DriverAudit[],
    hasMore: data.length > 25,
  };
}
export async function readDriverAccounts(): Promise<{
  available: boolean;
  drivers: DriverAccount[];
}> {
  const { data, error } = await (
    await createClient()
  ).rpc("admin_driver_directory");
  if (error) {
    if (["PGRST202", "42883"].includes(error.code))
      return { available: false, drivers: [] };
    throw new Error("Driver accounts could not be loaded. Please retry.");
  }
  return { available: true, drivers: data as DriverAccount[] };
}
export async function writeAccount(command: Command): Promise<string> {
  const { data, error } = await (
    await createClient()
  ).rpc(command.rpc, command.args);
  if (error) {
    if (["PGRST202", "42883"].includes(error.code))
      throw new Error("The driver approval migration is required.");
    if (
      ["22023", "42501", "40001"].includes(error.code) &&
      error.message.length < 250 &&
      !error.message.includes("permission denied")
    )
      throw new Error(error.message);
    throw new Error("Account could not be saved. Please retry.");
  }
  return data as string;
}
