import { tr, money } from "@/domain/localization/format";
import type { Locale } from "@/domain/localization/locale";
import { formatBusinessDate } from "@/domain/localization/calendar";
import { sum } from "./money";
import { digits } from "@/domain/localization/locale";
import {
  invoiceTotals,
  invoicePaymentStatus,
  invoiceDeliveries,
  invoiceFreeValue,
} from "./reports";
import { deliveryText } from "@/domain/operations/product-delivery";
import type { Invoice, FinanceWorkspace, Payment, Company } from "./types";
export type ReceiptDocument = {
  title: string;
  company: Company;
  lines: string[];
};
export function invoiceDocument(
  i: Invoice,
  f: FinanceWorkspace,
  locale: Locale = "en",
): ReceiptDocument {
  const npr = (value: string) => money(value, locale);
  const totals = invoiceTotals(i, f),
    sale = f.sales.find((s) => s.id === i.sale_id)!;
  const lines = [
    ...(sale.supply_classification === "FREE_SUPPLY"
      ? [tr(locale, "Free Supply"), tr(locale, "No Payment Required")]
      : []),
    tr(locale, "Invoice MK-{0}", [i.number.padStart(8, "0")]),
    tr(locale, "Customer: {0}", [i.customer.name]),
    i.customer.shop_name,
    i.customer.address,
    i.customer.phone,
    tr(locale, "Business date: {0}", [
      formatBusinessDate(i.date_label, locale),
    ]),
    tr(locale, "Invoice date: {0}", [
      formatBusinessDate(i.created_at, locale, true),
    ]),
    tr(locale, "Business day ID: {0}", [sale.business_day_id]),
    tr(locale, "Due: {0}", [
      i.due_date
        ? formatBusinessDate(i.due_date, locale)
        : tr(locale, "Unconfigured"),
    ]),
    ...invoiceDeliveries(i, f).map((line) => deliveryText(line, locale)),
    ...f.items
      .filter((s) => s.sale_id === i.sale_id)
      .map((s) =>
        tr(locale, "{0} ({1}) | {2} x {3} | {4}", [
          s.name,
          s.unit,
          s.quantity,
          npr(s.unit_price),
          npr(s.total),
        ]),
      ),
    tr(locale, "Subtotal: {0}", [npr(i.subtotal)]),
    ...(sale.supply_classification === "FREE_SUPPLY" ||
    sale.supply_classification === "MIXED"
      ? [
          `${tr(locale, "Value of Free Supply")}: ${npr(invoiceFreeValue(i, f))}`,
        ]
      : []),
    ...f.items
      .filter(
        (s) =>
          s.sale_id === i.sale_id && s.supply_classification === "FREE_SUPPLY",
      )
      .map(
        (s) =>
          `${s.name} · ${tr(locale, "Free Supply")} · ${tr(locale, "Reference Price")}: ${npr(s.reference_price_snapshot ?? "0.00")}`,
      ),
    i.company.tax_mode === "UNCONFIGURED"
      ? tr(locale, "Tax: UNCONFIGURED - registration requirements pending")
      : `${i.company.tax_label || tr(locale, "Tax")}: ${money(i.tax, locale)} (${digits(i.company.tax_rate, locale)}%)`,
    tr(locale, "Original invoice total: {0}", [npr(i.total)]),
    ...f.adjustments
      .filter((a) => a.invoice_id === i.id)
      .map((a) =>
        tr(locale, "Adjustment: {0} | {1}", [
          npr(sum([a.subtotal_delta, a.tax_delta])),
          a.reason,
        ]),
      ),
    tr(locale, "Current total: {0}", [npr(totals.effective)]),
    `${tr(locale, "Total Amount")}: ${npr(totals.effective)}`,
    `${tr(locale, "Payment Status")}: ${tr(locale, invoicePaymentStatus(i, f))}`,
    tr(locale, "Collected: {0}", [npr(totals.collected)]),
    tr(locale, "Pending Fonepay: {0}", [npr(totals.pending)]),
    tr(locale, "Outstanding: {0}", [npr(i.outstanding)]),
  ];
  for (const a of f.allocations.filter((a) => a.invoice_id === i.id)) {
    const p = f.payments.find((p) => p.id === a.payment_id);
    if (p)
      lines.push(
        tr(locale, "R-{0} | {1} | {2} | allocated {3}", [
          p.number.padStart(8, "0"),
          tr(locale, p.method),
          tr(
            locale,
            p.status === "CONFIRMED"
              ? p.method === "CASH"
                ? "Cash recorded"
                : "Admin reconciled"
              : p.status,
          ),
          npr(a.amount),
        ]),
      );
  }
  lines.push(
    tr(
      locale,
      "Payment status is current at download time. Pending Fonepay does not reduce outstanding credit.",
    ),
    tr(locale, "Refundable deposits are separate from invoice sales."),
  );
  return {
    title: tr(locale, "Invoice MK-{0}", [i.number.padStart(8, "0")]),
    company: i.company,
    lines: lines.filter(Boolean),
  };
}
export function paymentDocument(
  p: Payment,
  f: FinanceWorkspace,
  date: string,
  locale: Locale = "en",
): ReceiptDocument {
  const npr = (value: string) => money(value, locale);
  return {
    title: tr(locale, "Receipt R-{0}", [p.number.padStart(8, "0")]),
    company: p.company_snapshot,
    lines: [
      tr(locale, "Receipt R-{0}", [p.number.padStart(8, "0")]),
      tr(locale, "Customer: {0}", [p.customer_snapshot.name]),
      p.customer_snapshot.address,
      p.customer_snapshot.phone,
      tr(locale, "Business date: {0}", [formatBusinessDate(date, locale)]),
      tr(locale, "Payment date: {0}", [
        formatBusinessDate(p.created_at, locale, true),
      ]),
      tr(locale, "Business day ID: {0}", [p.business_day_id]),
      tr(locale, "Amount: {0}", [npr(p.amount)]),
      tr(locale, "Method: {0}", [tr(locale, p.method)]),
      tr(locale, "Current status: {0}", [
        tr(
          locale,
          p.status === "CONFIRMED"
            ? p.method === "CASH"
              ? "Cash recorded"
              : "Admin reconciled"
            : p.status,
        ),
      ]),
      tr(locale, "Refundable deposit: {0} - separate from sales", [
        npr(p.deposit_amount),
      ]),
      tr(locale, "Entered reference (unverified): {0}", [
        p.reference || tr(locale, "None"),
      ]),
      ...f.allocations
        .filter((a) => a.payment_id === p.id)
        .flatMap((a) => {
          const i = f.invoices.find((i) => i.id === a.invoice_id);
          return [
            `${i ? tr(locale, "MK-{0}", [i.number.padStart(8, "0")]) : tr(locale, "Prior customer invoice")}: ${money(a.amount, locale)}`,
            ...(i
              ? [
                  `${tr(locale, "Payment Status")}: ${tr(locale, invoicePaymentStatus(i, f))}`,
                  `${tr(locale, "Total Amount")}: ${npr(invoiceTotals(i, f).effective)}`,
                  ...invoiceDeliveries(i, f).map((line) =>
                    deliveryText(line, locale),
                  ),
                ]
              : []),
          ];
        }),
      ...f.events
        .filter((e) => e.payment_id === p.id)
        .sort((a, b) => a.sequence - b.sequence)
        .map(
          (e) =>
            `${tr(locale, e.status)} | ${tr(locale, e.source)} | ${e.evidence}`,
        ),
      tr(
        locale,
        "Status is current at download time. Fonepay references alone are not proof of payment.",
      ),
    ].filter(Boolean),
  };
}
