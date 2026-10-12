import "server-only";
import { requireIdentity, requirePermission } from "./auth";
import { parseAccountCommand } from "@/domain/auth/accounts";
import { readDriverAccounts, writeAccount } from "@/data-access/accounts";
export async function getDriverAccounts() {
  await requirePermission("admin:read");
  return readDriverAccounts();
}
export async function saveAccount(form: FormData) {
  const command = parseAccountCommand(form);
  if (command.admin) await requirePermission("admin:read");
  else await requireIdentity();
  return writeAccount(command);
}
