import {
  adToBs,
  bsToAdIso,
  daysInBsMonth,
  bsWeekday,
  MIN_BS_YEAR,
  MAX_BS_YEAR,
  EPOCH_AD_ISO,
  MAX_AD_ISO,
  type BsDate,
} from "@inicrea/bikram-sambat-core";
import {
  BUSINESS_TIME_ZONE,
  nepalDateLabel,
} from "@/domain/business-days/time";
import { digits, type Locale } from "./locale";
export {
  adToBs,
  bsToAdIso,
  daysInBsMonth,
  bsWeekday,
  MIN_BS_YEAR,
  MAX_BS_YEAR,
  EPOCH_AD_ISO,
  MAX_AD_ISO,
};
export type { BsDate };
export const months = {
  en: [
    "Baisakh",
    "Jestha",
    "Ashadh",
    "Shrawan",
    "Bhadra",
    "Ashwin",
    "Kartik",
    "Mangsir",
    "Poush",
    "Magh",
    "Falgun",
    "Chaitra",
  ],
  ne: [
    "बैशाख",
    "जेठ",
    "असार",
    "साउन",
    "भदौ",
    "असोज",
    "कात्तिक",
    "मंसिर",
    "पुस",
    "माघ",
    "फागुन",
    "चैत",
  ],
} as const;
export function canonicalDate(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const date = new Date(value + "T00:00:00Z");
    if (
      !Number.isFinite(date.getTime()) ||
      date.toISOString().slice(0, 10) !== value
    )
      throw new RangeError("Invalid date.");
    return value;
  }
  if (!/^\d{4}-\d{2}-\d{2}T/.test(value)) throw new RangeError("Invalid date.");
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new RangeError("Invalid date.");
  return nepalDateLabel(date);
}
export function currentBs(now = new Date()): BsDate {
  return adToBs(nepalDateLabel(now));
}
export function formatBusinessDate(
  value: string,
  locale: Locale = "en",
  time = false,
): string {
  if (!value) return "";
  let date: BsDate;
  try {
    date = adToBs(canonicalDate(value));
  } catch {
    return locale === "ne"
      ? "BS मिति उपलब्ध छैन (समर्थित अवधि बाहिर)"
      : "BS date unavailable (outside supported range)";
  }
  const text =
    digits(date.day, locale) +
    " " +
    months[locale][date.month - 1] +
    " " +
    digits(date.year, locale);
  if (!time || value.length === 10) return text;
  return (
    text +
    " · " +
    digits(
      new Intl.DateTimeFormat(locale === "ne" ? "ne-NP" : "en-NP", {
        timeZone: BUSINESS_TIME_ZONE,
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(new Date(value)),
      locale,
    )
  );
}
export function shiftDate(date: string, days: number): string {
  const stamp = new Date(canonicalDate(date) + "T00:00:00Z");
  stamp.setUTCDate(stamp.getUTCDate() + days);
  return stamp.toISOString().slice(0, 10);
}
export type DateRange = {
  from: string;
  to: string;
  start: string;
  end: string;
};
// IANA timezone data includes historical offsets and the midnight gap in 1986.
// Find the first real instant in a Nepal local date rather than assuming +05:45.
export function nepalMidnight(date: string): string {
  date = canonicalDate(date);
  const utc = Date.parse(date + "T00:00:00Z");
  let low = utc - 86400000,
    high = utc + 86400000;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (nepalDateLabel(new Date(mid)) < date) low = mid + 1;
    else high = mid;
  }
  return new Date(low).toISOString();
}
export function canonicalRange(from: string, to: string): DateRange {
  from = canonicalDate(from);
  to = canonicalDate(to);
  if (from > to) throw new RangeError("Start date must precede end date.");
  adToBs(from);
  adToBs(to);
  return {
    from,
    to,
    start: nepalMidnight(from),
    end: nepalMidnight(shiftDate(to, 1)),
  };
}
export const presets = [
  "today",
  "yesterday",
  "month",
  "previous-month",
  "year",
  "custom",
] as const;
export type DatePreset = (typeof presets)[number];
export function bsMonthRange(year: number, month: number): DateRange {
  return canonicalRange(
    bsToAdIso({ year, month, day: 1 }),
    bsToAdIso({ year, month, day: daysInBsMonth(year, month) }),
  );
}
export function presetRange(
  preset: Exclude<DatePreset, "custom">,
  now = new Date(),
): DateRange {
  const today = nepalDateLabel(now),
    bs = adToBs(today);
  if (preset === "today") return canonicalRange(today, today);
  if (preset === "yesterday") {
    const day = shiftDate(today, -1);
    return canonicalRange(day, day);
  }
  if (preset === "month") return bsMonthRange(bs.year, bs.month);
  if (preset === "previous-month")
    return bsMonthRange(
      bs.month === 1 ? bs.year - 1 : bs.year,
      bs.month === 1 ? 12 : bs.month - 1,
    );
  return canonicalRange(
    bsToAdIso({ year: bs.year, month: 1, day: 1 }),
    bsToAdIso({ year: bs.year, month: 12, day: daysInBsMonth(bs.year, 12) }),
  );
}
export function inDateRange(
  value: string,
  from?: string,
  to?: string,
  timestamp = true,
): boolean {
  if (!from && !to) return true;
  if (timestamp) {
    const instant = new Date(value).getTime();
    return (
      (!from || instant >= Date.parse(nepalMidnight(from))) &&
      (!to || instant < Date.parse(nepalMidnight(shiftDate(to, 1))))
    );
  }
  const date = canonicalDate(value);
  return (
    (!from || date >= canonicalDate(from)) && (!to || date <= canonicalDate(to))
  );
}
