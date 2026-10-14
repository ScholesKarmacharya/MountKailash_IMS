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
    [
      "save_delivery_customer",
      "save_delivery_contact",
      "request_house_contact",
    ].includes(command.rpc)
      ? "customer:operate"
      : command.admin
        ? "trip:assign"
        : "trip:operate",
  );
  // The UI option alone is not a guard. Atomic DB protection remains separate.
  if (command.rpc === "save_vehicle" && command.args.p_active === false) {
    const workspace = await readOperations();
    if (!workspace.available)
      throw new Error("Operations could not be loaded. Please retry.");
    if (
      workspace.trips.some(
        (t) => t.vehicle_id === command.args.p_id && t.status !== "CLOSED",
      )
    )
      throw new Error(
        "Complete or cancel the current trip before deactivating this vehicle.",
      );
  }
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
