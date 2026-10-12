export const locales = ["en", "ne"] as const;
export type Locale = (typeof locales)[number];
export function isLocale(value: unknown): value is Locale {
  return value === "en" || value === "ne";
}
export function userLocale(value: unknown, role: string): Locale {
  return isLocale(value) ? value : role === "DRIVER" ? "ne" : "en";
}
export function digits(value: string | number, locale: Locale): string {
  const text = String(value);
  return locale === "ne"
    ? text.replace(/\d/g, (d) => "०१२३४५६७८९"[Number(d)]!)
    : text;
}
export function latinDigits(value: string): string {
  return value.replace(/[०-९]/g, (d) => String("०१२३४५६७८९".indexOf(d)));
}
