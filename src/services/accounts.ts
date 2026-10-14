import "server-only";
import { requireIdentity, requirePermission } from "./auth";
import { parseAccountCommand } from "@/domain/auth/accounts";
import {
  readDriverAccounts,
  readDriverAudit,
  writeAccount,
} from "@/data-access/accounts";
import { uuid } from "@/domain/inventory/validation";
export async function getDriverAudit(id: string, page = 0) {
  await requirePermission("admin:read");
  return readDriverAudit(
    uuid(id),
    Number.isInteger(page) && page >= 0 && page <= 9999 ? page : 0,
  );
}
export async function getDriverAccounts() {
  await requirePermission("admin:read");
  return readDriverAccounts();
}
export async function saveAccount(form: FormData) {
  const command = parseAccountCommand(form);
  if (command.admin) await requirePermission("admin:read");
  else await requireIdentity();
  if (
    command.rpc === "save_driver_account" &&
    form.get("create_new") === "true"
  ) {
    const directory = await readDriverAccounts();
    if (!directory.available)
      throw new Error("The driver approval migration is required.");
    if (directory.drivers.some((driver) => driver.id === command.args.p_id))
      throw new Error(
        "This driver profile already exists. Open Driver Details to edit it.",
      );
  }
  return writeAccount(command);
}
