import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { DriverAccount } from "@/domain/auth/accounts";
import type { Command } from "@/domain/operations/commands";
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
