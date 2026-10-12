import {
  deliveryText,
  groupDeliveries,
} from "@/domain/operations/product-delivery";
import { digits } from "@/domain/localization/locale";
import { tr, money } from "@/domain/localization/format";
import type { Locale } from "@/domain/localization/locale";
import { formatBusinessDate } from "@/domain/localization/calendar";
import type { DayReport, DayTotals } from "./types";
import { sum } from "@/domain/finance/money";
import { pendingDays } from "@/domain/operations/pending-age";
import { stockLabels } from "@/domain/inventory/validation";
import type { ReceiptDocument } from "@/domain/finance/documents";
export const amountLabels = {
  sales: "Sales excluding tax",
  gross_sales: "Invoice sales including tax",
  tax: "Tax recorded",
  collections: "Confirmed collections",
  cash: "Cash receipts less reversals",
  fonepay: "Admin-reconciled Fonepay",
  pending_fonepay: "Pending Fonepay (excluded)",
  cash_net: "Net cash after refunds",
  new_credit: "New credit issued at sale",
  old_credit_recovered: "Previous-day credit recovered",
  outstanding: "Closing outstanding receivables",
  deposits_received: "Deposits received",
  deposits_refunded: "Deposits refunded",
  deposits_reversed: "Deposits reversed",
  deposit_liability: "Refundable deposit liability",
} satisfies Partial<Record<keyof DayTotals, string>>;
export function dayTripDeliveries(report: DayReport, tripIds: string[]) {
  return groupDeliveries(
    report.customers
      .filter((c) => tripIds.includes(c.trip_id))
      .flatMap((c) => c.items ?? []),
  );
}
export function groupedTrips(
  report: DayReport,
  dimension: "driver" | "vehicle",
) {
  const rows = new Map<
    string,
    {
      id: string;
      name: string;
      trips: number;
      full_jars: number;
      empty_jars: number;
      cartons: number;
      sales: string;
      collections: string;
    }
  >();
  const get = (id: string, name: string) => {
    if (!rows.has(id))
      rows.set(id, {
        id,
        name,
        trips: 0,
        full_jars: 0,
        empty_jars: 0,
        cartons: 0,
        sales: "0.00",
        collections: "0.00",
      });
    return rows.get(id)!;
  };
  for (const t of report.trips) {
    const r = get(
      dimension === "driver" ? t.driver_id : t.vehicle_id,
      dimension === "driver" ? t.driver_name : t.plate_number,
    );
    r.trips++;
    r.full_jars += t.full_jars;
    r.empty_jars += t.empty_jars;
    r.cartons += t.cartons;
    r.sales = sum([r.sales, t.sales]);
  }
  for (const p of report.payments) {
    const r = get(
      dimension === "driver" ? p.driver_id : p.vehicle_id,
      dimension === "driver" ? p.driver_name : p.plate_number,
    );
    r.collections = sum([
      r.collections,
      ...report.journal
        .filter(
          (j) =>
            j.source_id === p.id &&
            (j.account === "CASH" || j.account === "FONEPAY") &&
            ["PAYMENT", "REVERSAL"].includes(j.kind),
        )
        .map((j) => j.amount),
    ]);
  }
  return [...rows.values()].sort((a, b) => a.name.localeCompare(b.name));
}
// A shared row model keeps HTML detail, PDF and Excel-compatible CSV on the same stored facts.
export type ReportRow = {
  section: string;
  id: string;
  label: string;
  quantity?: number;
  amount?: string;
  details?: string;
};
export function reportRows(r: DayReport, locale: Locale = "en"): ReportRow[] {
  const rows: ReportRow[] = [
    {
      section: tr(locale, "Company snapshot"),
      id: r.day.id,
      label: r.company.name,
      details: [
        r.company.address,
        r.company.phone,
        r.company.registration,
        tr(locale, "Tax {0}; rate {1}", [
          tr(locale, r.company.tax_mode ?? "UNCONFIGURED"),
          r.company.tax_rate == null
            ? tr(locale, "Unconfigured")
            : digits(r.company.tax_rate, locale),
        ]),
      ]
        .filter(Boolean)
        .join("; "),
    },
    {
      section: tr(locale, "Day"),
      id: r.day.id,
      label: formatBusinessDate(r.day.date_label, locale),
      details: tr(locale, "{0}; {1}; timezone Asia/Kathmandu; version 1", [
        tr(locale, r.day.status),
        tr(locale, r.source),
      ]),
    },
    {
      section: tr(locale, "Day"),
      id: r.day.opened_by,
      label: tr(locale, "Opened"),
      details: tr(locale, "{0}; {1}; UTC {2}", [
        formatBusinessDate(r.day.opened_at, locale, true),
        r.day.opened_by_name,
        r.day.opened_at,
      ]),
    },
    {
      section: tr(locale, "Day"),
      id: r.day.closed_by ?? "",
      label: tr(locale, "Closed"),
      details: r.day.closed_at
        ? tr(locale, "{0}; {1}; UTC {2}", [
            formatBusinessDate(r.day.closed_at, locale, true),
            r.day.closed_by_name,
            r.day.closed_at,
          ])
        : tr(locale, "Not closed; live preview"),
    },
  ];
  for (const [key, label] of Object.entries(amountLabels))
    rows.push({
      section: tr(locale, "Money (NPR)"),
      id: key,
      label: tr(locale, label),
      amount: r.totals[key as keyof typeof amountLabels],
    });
  for (const [key, label] of Object.entries({
    trips: tr(locale, "Total trips"),
    completed_trips: tr(locale, "Completed trips"),
    pending_trips: tr(locale, "Pending trips"),
    full_jars: tr(locale, "Full jars delivered"),
    empty_jars: tr(locale, "Empty jars collected"),
    cartons: tr(locale, "Cartons sold"),
    refilled: tr(locale, "Jars refilled"),
    damaged: tr(locale, "Jars moved to damaged"),
  }))
    rows.push({
      section: tr(locale, "Counts"),
      id: key,
      label,
      quantity: r.totals[key as keyof typeof r.totals] as number,
    });
  if (r.reconciliation) {
    rows.push({
      section: tr(locale, "Reconciliation"),
      id: r.reconciliation.checked_by,
      label: tr(locale, "Net cash handed over"),
      amount: r.reconciliation.cash_counted,
      details: r.reconciliation.notes,
    });
    rows.push({
      section: tr(locale, "Reconciliation"),
      id: r.reconciliation.checked_by,
      label: tr(locale, "Cash discrepancy"),
      amount: r.reconciliation.cash_difference,
      details: tr(
        locale,
        "Cash, Fonepay, physical stock and carry-forward balances checked at {0}",
        [formatBusinessDate(r.reconciliation.checked_at, locale, true)],
      ),
    });
  }
  for (const s of r.stock) {
    const label = `${s.location_name} / ${s.name} / ${tr(locale, stockLabels[s.stock_kind])}`;
    rows.push({
      section: tr(locale, "Opening stock"),
      id: s.product_id,
      label,
      quantity: s.opening,
    });
    rows.push({
      section: tr(locale, "Closing stock"),
      id: s.product_id,
      label,
      quantity: s.closing,
    });
  }
  for (const dimension of ["driver", "vehicle"] as const)
    for (const g of groupedTrips(r, dimension)) {
      rows.push({
        section: tr(locale, "{0} item sales", [tr(locale, dimension)]),
        id: g.id,
        label: g.name,
        amount: g.sales,
        details: [
          tr(locale, "{0} trips", [g.trips]),
          ...dayTripDeliveries(
            r,
            r.trips
              .filter(
                (trip) =>
                  (dimension === "driver"
                    ? trip.driver_id
                    : trip.vehicle_id) === g.id,
              )
              .map((trip) => trip.id),
          ).map((line) => deliveryText(line, locale, true)),
          tr(locale, "Item sales before invoice corrections"),
        ].join("; "),
      });
      rows.push({
        section: tr(locale, "{0} collections", [tr(locale, dimension)]),
        id: g.id,
        label: g.name,
        amount: g.collections,
      });
    }
  for (const p of r.products)
    rows.push({
      section: tr(locale, "Product item sales"),
      id: p.product_id,
      label: p.name,
      amount: p.sales,
      details: [
        p.kind ? deliveryText({ ...p, kind: p.kind }, locale, true) : p.unit,
        tr(locale, "Item sales before invoice corrections"),
      ].join("; "),
    });
  for (const t of r.trips) {
    rows.push({
      section: tr(locale, "Trip"),
      id: t.id,
      label: tr(locale, "Trip #{0}", [t.trip_number]),
      amount: t.sales,
      details: [
        t.driver_name,
        t.plate_number,
        tr(locale, t.status),
        ...dayTripDeliveries(r, [t.id]).map((line) =>
          deliveryText(line, locale, true),
        ),
        t.close_reason,
      ]
        .filter(Boolean)
        .join("; "),
    });
    for (const c of t.checks)
      for (const i of c.items)
        rows.push({
          section: tr(locale, "Trip reconciliation"),
          id: c.id,
          label: tr(locale, "Trip #{0} / {1}", [
            t.trip_number,
            tr(locale, i.stock_kind),
          ]),
          quantity: i.actual,
          details: tr(
            locale,
            "Product {0}; expected {1}; declared {2}; actual {3}; {4}; actor {5}; {6}",
            [
              i.product_id,
              i.expected,
              i.declared,
              i.actual,
              tr(locale, c.outcome),
              c.actor_user_id,
              c.reason,
            ],
          ),
        });
  }
  for (const c of r.customers)
    rows.push({
      section: tr(locale, "Customer visit"),
      id: c.id,
      label: c.name,
      amount: c.sales,
      details: [
        tr(locale, "Trip #{0}", [c.trip_number]),
        c.invoice_number ?? tr(locale, "not posted"),
        ...(c.items ?? []).map((line) => deliveryText(line, locale)),
        tr(locale, "Tax"),
        money(c.tax, locale),
        formatBusinessDate(c.created_at, locale, true),
      ].join("; "),
    });
  for (const p of r.payments) {
    rows.push({
      section: tr(locale, "Receipt"),
      id: p.id,
      label: tr(locale, "MK-P-{0} / {1}", [p.number, p.customer_snapshot.name]),
      amount: p.amount,
      details: tr(locale, "{0}; {1}; {2}; deposit {3}; {4}; {5}; {6}", [
        tr(locale, p.method),
        tr(locale, p.status),
        p.reference,
        p.deposit_amount,
        p.driver_name,
        p.plate_number,
        formatBusinessDate(p.created_at, locale, true),
      ]),
    });
    for (const a of p.allocations)
      rows.push({
        section: tr(locale, "Receipt allocation"),
        id: p.id,
        label: tr(locale, "Invoice MK-{0}", [a.number]),
        amount: a.amount,
        details: tr(locale, "Invoice business date {0}; invoice {1}", [
          formatBusinessDate(a.date_label, locale),
          a.invoice_id,
        ]),
      });
  }
  for (const j of r.journal)
    rows.push({
      section: tr(locale, "Finance journal"),
      id: j.id,
      label: `${tr(locale, j.kind)} / ${tr(locale, j.account)}`,
      amount: j.amount,
      details: tr(locale, "Source {0}; {1}", [
        j.source_id,
        formatBusinessDate(j.created_at, locale, true),
      ]),
    });
  for (const p of r.processing)
    rows.push({
      section: tr(locale, "Warehouse processing"),
      id: p.id,
      label: `${tr(locale, p.operation)} / ${p.product_name} / ${tr(locale, p.stock_kind)}`,
      quantity: p.quantity,
      details: `${p.actor_name}; ${formatBusinessDate(p.created_at, locale, true)}; ${p.reason}`,
    });
  for (const c of r.custody)
    rows.push({
      section: tr(locale, "Customer jar carry-forward"),
      id: c.customer_id,
      label: `${c.name} / ${c.product_name}`,
      quantity: c.quantity,
    });
  for (const p of r.pending_jars ?? [])
    rows.push({
      section: tr(locale, "Pending jars by original date"),
      id: p.entry_id,
      label: `${p.customer_name} · ${p.product_name} · ${formatBusinessDate(p.original_date, locale, true)} · ${tr(locale, p.source)}`,
      quantity: p.pending,
      details: [
        tr(locale, "{0} days pending", [
          pendingDays(
            p.original_date,
            r.day.closed_at ? new Date(r.day.closed_at) : new Date(),
          ),
        ]),
        p.trip_number != null && tr(locale, "Round #{0}", [p.trip_number]),
        p.driver_name,
      ]
        .filter(Boolean)
        .join("; "),
    });
  for (const c of r.credit)
    rows.push({
      section: tr(locale, "Customer credit carry-forward"),
      id: c.customer_id,
      label: c.name,
      amount: c.outstanding,
    });
  for (const c of r.deposit_balances)
    rows.push({
      section: tr(locale, "Customer deposit carry-forward"),
      id: c.customer_id,
      label: c.name,
      amount: c.liability,
    });
  for (const [section, records] of [
    [tr(locale, "Movement"), r.movements],
    [tr(locale, "Stock adjustment"), r.adjustments],
    [tr(locale, "Invoice correction"), r.invoice_adjustments],
    [tr(locale, "Discrepancy"), r.discrepancies],
    [tr(locale, "Deposit"), r.deposits],
    [tr(locale, "Verification event"), r.events],
  ] as const)
    for (const record of records)
      rows.push({
        section,
        id: record.id,
        label: section,
        details: JSON.stringify(record),
      });
  return rows;
}
function csvText(value: string) {
  // Excel must never evaluate customer names/notes as spreadsheet formulas.
  const safe = /^[\s]*[=+\-@]|^[\t\r\n]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}
export function dailyCsv(report: DayReport, locale: Locale = "en") {
  const header =
    ["Section", "Record ID", "Label", "Quantity", "Amount NPR", "Details"]
      .map((k) => tr(locale, k))
      .join(",") + ",CanonicalBusinessDate";
  return (
    "\ufeff" +
    [
      header,
      ...reportRows(report, locale).map((r) =>
        [
          csvText(r.section),
          csvText(r.id),
          csvText(r.label),
          r.quantity ?? "",
          r.amount ?? "",
          csvText(r.details ?? ""),
          csvText(report.day.date_label),
        ].join(","),
      ),
    ].join("\r\n") +
    "\r\n"
  );
}
export function dailyDocument(
  report: DayReport,
  locale: Locale = "en",
): ReceiptDocument {
  return {
    title: tr(locale, "Business day {0} / {1}", [
      formatBusinessDate(report.day.date_label, locale),
      tr(
        locale,
        report.source === "ARCHIVED"
          ? "Closing archive v1"
          : "Unfinalized report",
      ),
    ]),
    company: report.company,
    lines: reportRows(report, locale).map(
      (r) =>
        `${r.section}: ${r.label}${r.quantity === undefined ? "" : ` | ${digits(r.quantity, locale)}`}${r.amount === undefined ? "" : ` | ${money(r.amount, locale)}`}${r.details ? ` | ${r.details}` : ""}${r.id ? ` [${r.id}]` : ""}`,
    ),
  };
}
