import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { InstantWorkspace, InstantHistory } from "@/domain/instant";
export async function readInstantWorkspace(): Promise<InstantWorkspace> {
  const { data, error } = await (await createClient()).rpc("instant_workspace");
  if (error) {
    if (["42P01", "PGRST202", "PGRST205"].includes(error.code))
      return { available: false, records: [], unavailable_reason: "schema" };
    throw new Error("Instant deliveries could not be loaded. Please retry.");
  }
  return { ...data, available: true };
}
export async function readInstantHistory(id: string): Promise<InstantHistory> {
  const { data, error } = await (
    await createClient()
  ).rpc("instant_history", { p_id: id });
  if (error)
    throw new Error(
      "Instant delivery history could not be loaded. Please retry.",
    );
  return data;
}
