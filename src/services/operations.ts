import "server-only";
import { requirePermission } from "./auth";
import {
  readOperations,
  writeOperation,
  readCustomerDeliveries,
  readDeliveryCustomer,
} from "@/data-access/operations";
import { parseCommand } from "@/domain/operations/commands";
import { uuid } from "@/domain/inventory/validation";
export async function getOperations(admin: boolean, trip?: string) {
  await requirePermission(admin ? "admin:read" : "driver:read");
  return readOperations(trip ? uuid(trip) : null);
}
export async function saveOperation(form: FormData) {
  const command = parseCommand(form);
  await requirePermission(
    ["save_delivery_customer", "save_delivery_contact"].includes(command.rpc)
      ? "customer:operate"
      : command.admin
        ? "trip:assign"
        : "trip:operate",
  );
  return writeOperation(command);
}
export async function getDeliveryCustomer(trip: string, customer: string) {
  await requirePermission("customer:operate");
  return readDeliveryCustomer(uuid(trip), uuid(customer));
}
export async function getCustomerDeliveries(id: string) {
  await requirePermission("admin:read");
  return readCustomerDeliveries(uuid(id));
}
