import "server-only";
import { requirePermission } from "./auth";
import { dayCommand, dateFilter } from "@/domain/business-days/commands";
import { uuid } from "@/domain/inventory/validation";
import { readDayHistory, readDayReport } from "@/data-access/day-reports";
import { writeOperation } from "@/data-access/operations";
export async function getDayHistory(from?: unknown, to?: unknown) {
  await requirePermission("admin:read");
  const start = dateFilter(from),
    end = dateFilter(to);
  if (start && end && start > end)
    throw new Error("Start date must precede end date.");
  return readDayHistory(start, end);
}
export async function getDayReport(id: string) {
  await requirePermission("admin:read");
  try {
    uuid(id);
  } catch {
    return null;
  }
  return readDayReport(id);
}
export async function saveDay(form: FormData) {
  await requirePermission("day:close");
  return writeOperation(dayCommand(form));
}
