import type { HouseWorkspace } from "./types";
import { freeSummary, freeGroups } from "./pricing";
import { tr, money } from "@/domain/localization/format";
import { formatBusinessDate } from "@/domain/localization/calendar";
import type { Locale } from "@/domain/localization/locale";
import type { Company } from "@/domain/finance/types";
import type { ReceiptDocument } from "@/domain/finance/documents";
export function freeExportRows(w: HouseWorkspace, locale: Locale) {
  const totals = freeSummary(w.rows);
  return [
    [tr(locale, "Free Supply Summary")],
    [tr(locale, "Total Free Jars"), String(totals.jars)],
    [tr(locale, "Total Free Cartons"), String(totals.cartons)],
    [tr(locale, "Value of Free Supply"), totals.value],
    [
      tr(
        locale,
        "Reference value only; excluded from revenue and customer credit.",
      ),
    ],
    [],
    [
      "Date",
      "Customer",
      "Driver",
      "Round",
      "Product",
      "Jars Delivered",
      "Cartons Delivered",
      "Empty Jars Returned",
      "Reference Price",
      "Value of Free Supply",
      "Original delivery transaction",
    ].map((k) => tr(locale, k)),
    ...w.rows.map((r) => [
      formatBusinessDate(r.occurred_at, locale, true),
      r.customer_name,
      r.driver_name,
      String(r.trip_number),
      r.product_name,
      String(r.full_jars),
      String(r.cartons),
      String(r.empty_jars),
      r.reference_price,
      r.reference_value,
      r.visit_id,
    ]),
    ...(["customer", "driver", "date", "month"] as const).flatMap((dim) => [
      [],
      [
        tr(
          locale,
          {
            customer: "Free Supply by Customer",
            driver: "Free Supply by Driver",
            date: "Free Supply by BS Date",
            month: "Monthly Free Supply Value",
          }[dim],
        ),
      ],
      ...freeGroups(w.rows, dim, locale).map((g) => [
        g.label,
        String(g.jars),
        String(g.cartons),
        g.value,
      ]),
    ]),
    [],
    [tr(locale, "Audited free supply corrections")],
    ...w.adjustments.map((a) => [
      formatBusinessDate(a.created_at, locale, true),
      a.customer_name,
      a.driver_name,
      a.amount,
      a.reason,
      a.visit_id,
    ]),
  ];
}
export function freeDocument(
  w: HouseWorkspace,
  company: Company,
  locale: Locale,
  from: string,
  to: string,
): ReceiptDocument {
  const totals = freeSummary(w.rows);
  return {
    title: tr(locale, "Pricing & Free Supply"),
    company,
    lines: [
      `${formatBusinessDate(from, locale)} — ${formatBusinessDate(to, locale)}`,
      `${tr(locale, "Value of Free Supply")}: ${money(totals.value, locale)}`,
      ...freeExportRows(w, locale).map((row) => row.join(" | ")),
    ],
  };
}
