export const BUSINESS_TIME_ZONE = "Asia/Kathmandu";
export function nepalDateLabel(timestamp: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(timestamp);
  const part = (type: string) => parts.find((p) => p.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
export function isOvernightDay(dateLabel: string, now = new Date()) {
  return dateLabel < nepalDateLabel(now);
}
export function formatNepalTime(timestamp: string) {
  return new Intl.DateTimeFormat("en-NP", {
    timeZone: BUSINESS_TIME_ZONE,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestamp));
}
