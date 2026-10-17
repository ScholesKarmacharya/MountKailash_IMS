import "server-only";
import { createClient } from "@/lib/supabase/server";
import { emptyWorkspace, type Workspace } from "@/domain/operations/types";
import type { Command } from "@/domain/operations/commands";
import type { DeliveryCustomerContext } from "@/domain/operations/customer-context";
import { readProductDeliveries } from "./product-deliveries";
import { customerDatabaseError } from "@/domain/operations/customer-errors";
import { confirmedCustomerContext } from "@/domain/operations/confirmed-customer";
export async function readDeliveryCustomer(
  trip: string,
  customer: string,
): Promise<DeliveryCustomerContext> {
  const client = await createClient();
  const { data, error, status } = await client.rpc(
    "delivery_customer_context",
    {
      p_trip: trip,
      p_customer: customer,
    },
  );
  if (error) {
    console.error("customer_lookup_failed", {
      rpc: "delivery_customer_context",
      status,
      databaseCode: error.code,
    });
    throw customerDatabaseError(error, status);
  }
  return confirmedCustomerContext(data, customer);
}
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
  const { data, error, status } = await client.rpc(command.rpc, command.args);
  if (error) {
    console.error("operation_save_failed", {
      rpc: command.rpc,
      status,
      databaseCode: error.code,
    });
    if (
      ["create_trip_with_load", "save_trip_draft_load"].includes(command.rpc) &&
      ["PGRST202", "42883", "42703", "42P01", "PGRST205"].includes(error.code)
    )
      throw new Error(
        "Trip creation with loading requires migration 31. Apply the reviewed migration, then retry.",
      );
    if (
      ["schedule_trip", "trip_preparation_command"].includes(command.rpc) &&
      ["PGRST202", "42883", "42703", "42P01", "PGRST205"].includes(error.code)
    )
      throw new Error(
        "Overnight trips are unavailable in this database. Apply the reviewed migrations 22 and 23, then refresh and retry.",
      );
    if (
      command.rpc === "post_driver_delivery" &&
      ["PGRST202", "42883"].includes(error.code)
    )
      throw new Error(
        "The reviewed driver payment migration is required before saving this delivery.",
      );
    if (error.code === "23505")
      throw new Error(
        command.rpc === "save_vehicle"
          ? "This number plate is already registered. Open the existing vehicle or enter another plate."
          : "That assignment, request or verified transaction reference already exists. Refresh and check before retrying.",
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
      "Unable to save this operation. Refresh and retry; check that the required migrations are installed.",
    );
  }
  if (typeof data !== "string")
    throw new Error(
      "The operation did not return a saved record. Please retry with the same request.",
    );
  return data;
}
export type CustomerDelivery = {
  supply_classification?: "SALE" | "FREE_SUPPLY" | "MIXED" | "RETURN_ONLY";
  free_value?: string;
  driver_name?: string;
  items?: import("@/domain/operations/product-delivery").ProductDelivery[];
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
  const visits = data as CustomerDelivery[];
  const items = await readProductDeliveries(
    client,
    visits.map((v) => v.id),
  );
  return visits.map((visit) => ({
    ...visit,
    items: items.filter((i) => i.visit_id === visit.id),
  }));
}
