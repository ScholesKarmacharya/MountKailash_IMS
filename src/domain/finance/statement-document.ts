import { creditStatement } from "./statement";
import type { FinanceWorkspace } from "./types";
import {
  formatBusinessDate,
  adToBs,
  bsMonthRange,
  months,
  type DateRange,
} from "@/domain/localization/calendar";
import { tr, money } from "@/domain/localization/format";
import type { Locale } from "@/domain/localization/locale";
import { digits } from "@/domain/localization/locale";
export function statementDocument(
  finance: FinanceWorkspace,
  customer: { id: string; name: string },
  range: DateRange,
  locale: Locale,
) {
  const statement = creditStatement(finance, customer.id, range);
  if (!finance.company)
    throw new Error("Finance could not be loaded. Please retry.");
  const bs = adToBs(range.from),
    month = bsMonthRange(bs.year, bs.month);
  return {
    title:
      range.from === month.from && range.to === month.to
        ? tr(locale, "{0} {1} credit statement", [
            months[locale][bs.month - 1],
            digits(bs.year, locale),
          ])
        : tr(locale, "BS credit statement"),
    company: finance.company,
    lines: [
      tr(locale, "Customer: {0}", [customer.name]),
      `${formatBusinessDate(range.from, locale)} – ${formatBusinessDate(range.to, locale)}`,
      tr(locale, "Opening credit: {0}", [money(statement.opening, locale)]),
      ...statement.rows.map(
        (row) =>
          `${formatBusinessDate(row.created_at, locale, true)} | ${tr(locale, row.kind)} | ${money(row.amount, locale)} | ${row.id}`,
      ),
      tr(locale, "Period change: {0}", [money(statement.change, locale)]),
      tr(locale, "Closing credit: {0}", [money(statement.closing, locale)]),
      tr(
        locale,
        "Customer jars and refundable deposits are separate from this credit statement.",
      ),
    ],
  };
}
function csvCell(value: string) {
  return (
    '"' +
    (/^[\s]*[=+\-@]/.test(value) ? "'" : "") +
    value.replaceAll('"', '""') +
    '"'
  );
}
export function statementCsv(
  finance: FinanceWorkspace,
  customer: { id: string; name: string },
  range: DateRange,
  locale: Locale,
) {
  const statement = creditStatement(finance, customer.id, range);
  const header = [
    tr(locale, "Date"),
    tr(locale, "Entry"),
    tr(locale, "Amount NPR"),
    "CanonicalTimestamp",
    "Record ID",
  ];
  const rows = [
    header,
    [
      tr(locale, "Opening credit"),
      "",
      statement.opening,
      range.start,
      customer.id,
    ],
    ...statement.rows.map((row) => [
      formatBusinessDate(row.created_at, locale, true),
      tr(locale, row.kind),
      row.amount,
      row.created_at,
      row.id,
    ]),
    [
      tr(locale, "Closing credit"),
      "",
      statement.closing,
      range.end,
      customer.id,
    ],
  ];
  return (
    "\ufeff" +
    rows
      .map((row) =>
        row
          .map((cell, index) =>
            index === 2 && /^-?\d+(?:\.\d{1,2})?$/.test(cell)
              ? cell
              : csvCell(cell),
          )
          .join(","),
      )
      .join("\r\n") +
    "\r\n"
  );
}
