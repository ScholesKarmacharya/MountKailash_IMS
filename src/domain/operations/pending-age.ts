import { nepalDateLabel } from "@/domain/business-days/time";
export function pendingDays(original: string, now = new Date()) {
  const start = Date.parse(nepalDateLabel(new Date(original)));
  const end = Date.parse(nepalDateLabel(now));
  return Math.max(0, Math.floor((end - start) / 86400000));
}
