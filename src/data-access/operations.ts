import "server-only";
import { createClient } from "@/lib/supabase/server";
import { emptyWorkspace, type Workspace } from "@/domain/operations/types";
import type { Command } from "@/domain/operations/commands";
export async function readOperations(
  trip: string | null = null,
): Promise<Workspace> {
  const client = await createClient();
  const { data, error } = await client.rpc("operations_workspace", {
    p_trip: trip,
  });
  if (error) {
    if (["42P01", "PGRST202", "PGRST205"].includes(error.code))
      return { ...emptyWorkspace };
    throw new Error("Operations could not be loaded. Please retry.");
  }
  return { ...emptyWorkspace, ...data, available: true } as Workspace;
}
export async function writeOperation(command: Command): Promise<string> {
  const client = await createClient();
  const { data, error } = await client.rpc(command.rpc, command.args);
  if (error) {
    if (error.code === "23505")
      throw new Error(
        "That vehicle, driver, plate or request is already assigned. Refresh and check before retrying.",
      );
    if (error.code === "23503")
      throw new Error(
        "Referenced record was not found. For a new driver, provision the Auth account first.",
      );
    // Only deliberately authored validation messages are shown; provider diagnostics stay private.
    if (
      ["22023", "42501", "40001"].includes(error.code) &&
      !error.message.includes("permission denied") &&
      error.message.length < 250 &&
      !error.message.includes("invalid input syntax")
    )
      throw new Error(error.message);
    throw new Error(
      "Unable to save this operation. Refresh and retry; check that Sprint 2 migrations are installed.",
    );
  }
  if (typeof data !== "string")
    throw new Error(
      "The operation did not return a saved record. Please retry with the same request.",
    );
  return data;
}
export type CustomerDelivery = {
  id: string;
  trip_id: string;
  trip_number: number;
  date_label: string;
  status: string;
  created_at: string;
  full_jars: number;
  empty_jars: number;
  cartons: number;
  value_snapshot: string;
};
export async function readCustomerDeliveries(
  id: string,
): Promise<CustomerDelivery[]> {
  const client = await createClient();
  const { data, error } = await client.rpc("customer_delivery_history", {
    p_customer: id,
  });
  if (error)
    throw new Error(
      "Customer delivery history could not be loaded. Please retry.",
    );
  return data as CustomerDelivery[];
}
