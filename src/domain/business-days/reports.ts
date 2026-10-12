import type { DayReport, DayTotals } from "./types";
import { sum, npr } from "@/domain/finance/money";
import { formatNepalTime } from "./time";
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
export function reportRows(r: DayReport): ReportRow[] {
  const rows: ReportRow[] = [
    {
      section: "Company snapshot",
      id: r.day.id,
      label: r.company.name,
      details: [
        r.company.address,
        r.company.phone,
        r.company.registration,
        `Tax ${r.company.tax_mode}; rate ${r.company.tax_rate}`,
      ]
        .filter(Boolean)
        .join("; "),
    },
    {
      section: "Day",
      id: r.day.id,
      label: r.day.date_label,
      details: `${r.day.status}; ${r.source}; timezone Asia/Kathmandu; version 1`,
    },
    {
      section: "Day",
      id: r.day.opened_by,
      label: "Opened",
      details: `${formatNepalTime(r.day.opened_at)}; ${r.day.opened_by_name}; UTC ${r.day.opened_at}`,
    },
    {
      section: "Day",
      id: r.day.closed_by ?? "",
      label: "Closed",
      details: r.day.closed_at
        ? `${formatNepalTime(r.day.closed_at)}; ${r.day.closed_by_name}; UTC ${r.day.closed_at}`
        : "Not closed; live preview",
    },
  ];
  for (const [key, label] of Object.entries(amountLabels))
    rows.push({
      section: "Money (NPR)",
      id: key,
      label,
      amount: r.totals[key as keyof typeof amountLabels],
    });
  for (const [key, label] of Object.entries({
    trips: "Total trips",
    completed_trips: "Completed trips",
    pending_trips: "Pending trips",
    full_jars: "Full jars delivered",
    empty_jars: "Empty jars collected",
    cartons: "Cartons sold",
    refilled: "Jars refilled",
    damaged: "Jars moved to damaged",
  }))
    rows.push({
      section: "Counts",
      id: key,
      label,
      quantity: r.totals[key as keyof typeof r.totals] as number,
    });
  if (r.reconciliation) {
    rows.push({
      section: "Reconciliation",
      id: r.reconciliation.checked_by,
      label: "Net cash handed over",
      amount: r.reconciliation.cash_counted,
      details: r.reconciliation.notes,
    });
    rows.push({
      section: "Reconciliation",
      id: r.reconciliation.checked_by,
      label: "Cash discrepancy",
      amount: r.reconciliation.cash_difference,
      details: `Cash, Fonepay, physical stock and carry-forward balances checked at ${r.reconciliation.checked_at}`,
    });
  }
  for (const s of r.stock) {
    const label = `${s.location_name} / ${s.name} / ${stockLabels[s.stock_kind]}`;
    rows.push({
      section: "Opening stock",
      id: s.product_id,
      label,
      quantity: s.opening,
    });
    rows.push({
      section: "Closing stock",
      id: s.product_id,
      label,
      quantity: s.closing,
    });
  }
  for (const dimension of ["driver", "vehicle"] as const)
    for (const g of groupedTrips(r, dimension)) {
      rows.push({
        section: `${dimension} item sales`,
        id: g.id,
        label: g.name,
        amount: g.sales,
        details: `${g.trips} trips; ${g.full_jars} full / ${g.empty_jars} empties / ${g.cartons} cartons; excludes invoice-level corrections`,
      });
      rows.push({
        section: `${dimension} collections`,
        id: g.id,
        label: g.name,
        amount: g.collections,
      });
    }
  for (const p of r.products)
    rows.push({
      section: "Product item sales",
      id: p.product_id,
      label: p.name,
      amount: p.sales,
      details: `${p.full_jars} full / ${p.empty_jars} empties / ${p.cartons} cartons; ${p.unit}; excludes invoice-level corrections`,
    });
  for (const t of r.trips) {
    rows.push({
      section: "Trip",
      id: t.id,
      label: `Trip #${t.trip_number}`,
      amount: t.sales,
      details: `${t.driver_name}; ${t.plate_number}; ${t.status}; ${t.full_jars} full / ${t.empty_jars} empties / ${t.cartons} cartons; ${t.close_reason}`,
    });
    for (const c of t.checks)
      for (const i of c.items)
        rows.push({
          section: "Trip reconciliation",
          id: c.id,
          label: `Trip #${t.trip_number} / ${i.stock_kind}`,
          quantity: i.actual,
          details: `Product ${i.product_id}; expected ${i.expected}; declared ${i.declared}; actual ${i.actual}; ${c.outcome}; actor ${c.actor_user_id}; ${c.reason}`,
        });
  }
  for (const c of r.customers)
    rows.push({
      section: "Customer visit",
      id: c.id,
      label: c.name,
      amount: c.sales,
      details: `Trip #${c.trip_number}; invoice ${c.invoice_number ?? "not posted"}; ${c.full_jars} full / ${c.empty_jars} empties / ${c.cartons} cartons; tax ${c.tax}; ${c.created_at}`,
    });
  for (const p of r.payments) {
    rows.push({
      section: "Receipt",
      id: p.id,
      label: `MK-P-${p.number} / ${p.customer_snapshot.name}`,
      amount: p.amount,
      details: `${p.method}; ${p.status}; ${p.reference}; deposit ${p.deposit_amount}; ${p.driver_name}; ${p.plate_number}; ${p.created_at}`,
    });
    for (const a of p.allocations)
      rows.push({
        section: "Receipt allocation",
        id: p.id,
        label: `Invoice MK-${a.number}`,
        amount: a.amount,
        details: `Invoice business date ${a.date_label}; invoice ${a.invoice_id}`,
      });
  }
  for (const j of r.journal)
    rows.push({
      section: "Finance journal",
      id: j.id,
      label: `${j.kind} / ${j.account}`,
      amount: j.amount,
      details: `Source ${j.source_id}; ${j.created_at}`,
    });
  for (const p of r.processing)
    rows.push({
      section: "Warehouse processing",
      id: p.id,
      label: `${p.operation} / ${p.product_name} / ${p.stock_kind}`,
      quantity: p.quantity,
      details: `${p.actor_name}; ${p.created_at}; ${p.reason}`,
    });
  for (const c of r.custody)
    rows.push({
      section: "Customer jar carry-forward",
      id: c.customer_id,
      label: `${c.name} / ${c.product_name}`,
      quantity: c.quantity,
    });
  for (const p of r.pending_jars ?? [])
    rows.push({
      section: "Pending jars by original date",
      id: p.entry_id,
      label: `${p.customer_name} · ${p.product_name} · ${formatNepalTime(p.original_date)} · ${p.source}`,
      quantity: p.pending,
      details: [
        `${pendingDays(p.original_date, r.day.closed_at ? new Date(r.day.closed_at) : new Date())} days pending`,
        p.trip_number != null && `Round #${p.trip_number}`,
        p.driver_name,
      ]
        .filter(Boolean)
        .join("; "),
    });
  for (const c of r.credit)
    rows.push({
      section: "Customer credit carry-forward",
      id: c.customer_id,
      label: c.name,
      amount: c.outstanding,
    });
  for (const c of r.deposit_balances)
    rows.push({
      section: "Customer deposit carry-forward",
      id: c.customer_id,
      label: c.name,
      amount: c.liability,
    });
  for (const [section, records] of [
    ["Movement", r.movements],
    ["Stock adjustment", r.adjustments],
    ["Invoice correction", r.invoice_adjustments],
    ["Discrepancy", r.discrepancies],
    ["Deposit", r.deposits],
    ["Verification event", r.events],
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
export function dailyCsv(report: DayReport) {
  const header = "Section,Record ID,Label,Quantity,Amount NPR,Details";
  return (
    "\ufeff" +
    [
      header,
      ...reportRows(report).map((r) =>
        [
          csvText(r.section),
          csvText(r.id),
          csvText(r.label),
          r.quantity ?? "",
          r.amount ?? "",
          csvText(r.details ?? ""),
        ].join(","),
      ),
    ].join("\r\n") +
    "\r\n"
  );
}
export function dailyDocument(report: DayReport): ReceiptDocument {
  return {
    title: `Business day ${report.day.date_label} / ${report.source === "ARCHIVED" ? "Closing archive v1" : "Unfinalized report"}`,
    company: report.company,
    lines: reportRows(report).map(
      (r) =>
        `${r.section}: ${r.label}${r.quantity === undefined ? "" : ` | ${r.quantity}`}${r.amount === undefined ? "" : ` | ${npr(r.amount)}`}${r.details ? ` | ${r.details}` : ""}${r.id ? ` [${r.id}]` : ""}`,
    ),
  };
}
