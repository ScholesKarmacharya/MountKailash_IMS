import "server-only";
import { requirePermission } from "./auth";
import {
  readInstantHistory,
  readInstantWorkspace,
} from "@/data-access/instant";
import { uuid } from "@/domain/inventory/validation";
export async function getInstantWorkspace(admin = false) {
  await requirePermission(admin ? "admin:read" : "driver:read");
  return readInstantWorkspace();
}
export async function getInstantHistory(id: string, admin = false) {
  await requirePermission(admin ? "admin:read" : "driver:read");
  return readInstantHistory(uuid(id));
}
