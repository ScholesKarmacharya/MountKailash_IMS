import { digits, type Locale } from "./locale";
import { message } from "@/lib/i18n/messages";
import { npr } from "@/domain/finance/money";
export function tr(
  locale: Locale,
  key: string,
  values: (string | number | null | undefined)[] = [],
): string {
  return message(locale, key).replace(/\{(\d+)\}/g, (_, i) => {
    const value = values[Number(i)];
    return typeof value === "number"
      ? digits(value, locale)
      : String(value ?? "");
  });
}
export function money(value: string, locale: Locale) {
  return digits(npr(value), locale);
}
