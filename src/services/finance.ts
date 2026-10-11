import "server-only";
import { requirePermission } from "./auth";
import { readFinance } from "@/data-access/finance";
import { writeOperation } from "@/data-access/operations";
import { financeCommand } from "@/domain/finance/commands";
export async function getFinance(admin: boolean) {
  await requirePermission(admin ? "admin:read" : "trip:operate");
  return readFinance();
}
export async function saveFinance(form: FormData) {
  const command = financeCommand(form);
  await requirePermission(command.admin ? "finance:manage" : "payment:record");
  return writeOperation(command);
}
