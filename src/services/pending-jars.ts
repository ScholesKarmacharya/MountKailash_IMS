import "server-only";
import { requirePermission } from "./auth";
import { uuid } from "@/domain/inventory/validation";
import { readPendingJars } from "@/data-access/pending-jars";
export async function getPendingJars(
  admin: boolean,
  trip?: string,
  customer?: string,
) {
  await requirePermission(admin ? "admin:read" : "trip:operate");
  if (!admin && !trip) throw new Error("An assigned trip is required.");
  return readPendingJars(
    trip ? uuid(trip) : null,
    customer ? uuid(customer) : null,
  );
}
