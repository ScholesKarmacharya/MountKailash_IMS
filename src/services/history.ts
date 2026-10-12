import "server-only";
import { requirePermission } from "./auth";
import { readStockHistory, readTripHistory } from "@/data-access/history";
import {
  canonicalRange,
  EPOCH_AD_ISO,
  MAX_AD_ISO,
} from "@/domain/localization/calendar";
export function historyRange(from?: string, to?: string) {
  return from || to
    ? canonicalRange(from || EPOCH_AD_ISO, to || MAX_AD_ISO)
    : undefined;
}
export async function getStockHistory(from?: string, to?: string, page = 0) {
  await requirePermission("admin:read");
  return readStockHistory(historyRange(from, to), page);
}
export async function getTripHistory(
  from: string | undefined,
  to: string | undefined,
  admin: boolean,
) {
  await requirePermission(admin ? "admin:read" : "driver:read");
  const range = historyRange(from, to);
  return range ? readTripHistory(range) : null;
}
