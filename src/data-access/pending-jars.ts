import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { PendingJarWorkspace } from "@/domain/operations/pending-jars";
export async function readPendingJars(
  trip: string | null,
  customer: string | null,
  directory = false,
): Promise<PendingJarWorkspace> {
  const client = await createClient();
  const { data, error } = await client.rpc(
    directory ? "pending_jar_directory" : "pending_jar_workspace",
    directory
      ? { p_customer: customer }
      : { p_trip: trip, p_customer: customer },
  );
  if (error) {
    if (["42P01", "PGRST202", "PGRST205"].includes(error.code))
      return { available: false, rows: [] };
    throw new Error("Pending jars could not be loaded. Please retry.");
  }
  return { ...data, available: true } as PendingJarWorkspace;
}
