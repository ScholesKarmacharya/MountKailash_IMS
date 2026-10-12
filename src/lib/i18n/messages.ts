import english from "./en.json";
import nepali from "./ne.json";
import { digits, type Locale } from "@/domain/localization/locale";
import { formatBusinessDate } from "@/domain/localization/calendar";
export const dictionaries: Record<Locale, Record<string, string>> = {
  en: english,
  ne: nepali,
};
export function message(locale: Locale, key: string): string {
  return dictionaries[locale][key] ?? dictionaries.en[key] ?? key;
}
const patterns = Object.keys(english)
  .filter((k) => /\{\d+\}/.test(k))
  .map((key) => {
    const parts = key.split(/(\{\d+\})/);
    const indices: number[] = [];
    const regex = new RegExp(
      "^" +
        parts
          .map((p) => {
            const match = /^\{(\d+)\}$/.exec(p);
            if (match) {
              indices.push(Number(match[1]));
              return "([\\s\\S]*?)";
            }
            return p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          })
          .join("") +
        "$",
    );
    return { key, indices, regex };
  });
/** Only explicit UI message callers use this; customer-entered text never does. */
export function translateMessage(locale: Locale, value: string): string {
  if (dictionaries.en[value] !== undefined) return message(locale, value);
  for (const p of patterns) {
    const found = p.regex.exec(value);
    if (found) {
      const values: Record<number, string> = {};
      p.indices.forEach((index, i) => {
        const value = found[i + 1]!;
        values[index] =
          /business day|Business day|business date|Business date|original date/i.test(
            p.key,
          ) && /^\d{4}-\d{2}-\d{2}$/.test(value)
            ? formatBusinessDate(value, locale)
            : value;
        if (
          /^(Decrease|Increase|Invalid|Missing) \{0\}|must contain|^Record \{0\}/.test(
            p.key,
          ) &&
          index === 0
        )
          values[index] = message(locale, value);
        if (/^Record \{0\} NPR \{1\}/.test(p.key) && index === 1)
          values[index] = message(locale, value);
        if (/^\d+(?:[.,]\d+)*$/.test(value) && !/MK-|R-/.test(p.key))
          values[index] = digits(value, locale);
      });
      return message(locale, p.key).replace(
        /\{(\d+)\}/g,
        (_, i) => values[Number(i)] ?? "",
      );
    }
  }
  return value;
}
