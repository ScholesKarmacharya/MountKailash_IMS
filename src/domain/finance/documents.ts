import { npr, sum } from "./money";
import { invoiceTotals } from "./reports";
import type { Invoice, FinanceWorkspace, Payment, Company } from "./types";
export type ReceiptDocument = {
  title: string;
  company: Company;
  lines: string[];
};
export function invoiceDocument(
  i: Invoice,
  f: FinanceWorkspace,
): ReceiptDocument {
  const totals = invoiceTotals(i, f),
    sale = f.sales.find((s) => s.id === i.sale_id)!;
  const lines = [
    `Invoice MK-${i.number.padStart(8, "0")}`,
    `Customer: ${i.customer.name}`,
    i.customer.shop_name,
    i.customer.address,
    i.customer.phone,
    `Business date: ${i.date_label}`,
    `Business day ID: ${sale.business_day_id}`,
    `Due: ${i.due_date ?? "Unconfigured"}`,
    ...f.items
      .filter((s) => s.sale_id === i.sale_id)
      .map(
        (s) =>
          `${s.name} (${s.unit}) | ${s.quantity} x ${npr(s.unit_price)} | ${npr(s.total)}`,
      ),
    `Subtotal: ${npr(i.subtotal)}`,
    i.company.tax_mode === "UNCONFIGURED"
      ? "Tax: UNCONFIGURED - registration requirements pending"
      : `${i.company.tax_label || "Tax"}: ${npr(i.tax)} (${i.company.tax_rate}%)`,
    `Original invoice total: ${npr(i.total)}`,
    ...f.adjustments
      .filter((a) => a.invoice_id === i.id)
      .map(
        (a) =>
          `Adjustment: ${npr(sum([a.subtotal_delta, a.tax_delta]))} | ${a.reason}`,
      ),
    `Current total: ${npr(totals.effective)}`,
    `Collected: ${npr(totals.collected)}`,
    `Pending Fonepay: ${npr(totals.pending)}`,
    `Outstanding: ${npr(i.outstanding)}`,
  ];
  for (const a of f.allocations.filter((a) => a.invoice_id === i.id)) {
    const p = f.payments.find((p) => p.id === a.payment_id);
    if (p)
      lines.push(
        `R-${p.number.padStart(8, "0")} | ${p.method} | ${p.status === "CONFIRMED" ? (p.method === "CASH" ? "Cash recorded" : "Admin reconciled") : p.status} | allocated ${npr(a.amount)}`,
      );
  }
  lines.push(
    "Payment status is current at download time. Pending Fonepay does not reduce outstanding credit.",
    "Refundable deposits are separate from invoice sales.",
  );
  return {
    title: `Invoice MK-${i.number.padStart(8, "0")}`,
    company: i.company,
    lines: lines.filter(Boolean),
  };
}
export function paymentDocument(
  p: Payment,
  f: FinanceWorkspace,
  date: string,
): ReceiptDocument {
  return {
    title: `Receipt R-${p.number.padStart(8, "0")}`,
    company: p.company_snapshot,
    lines: [
      `Receipt R-${p.number.padStart(8, "0")}`,
      `Customer: ${p.customer_snapshot.name}`,
      p.customer_snapshot.address,
      p.customer_snapshot.phone,
      `Business date: ${date}`,
      `Business day ID: ${p.business_day_id}`,
      `Amount: ${npr(p.amount)}`,
      `Method: ${p.method}`,
      `Current status: ${p.status === "CONFIRMED" ? (p.method === "CASH" ? "Cash recorded" : "Admin reconciled") : p.status}`,
      `Refundable deposit: ${npr(p.deposit_amount)} - separate from sales`,
      `Entered reference (unverified): ${p.reference || "None"}`,
      ...f.allocations
        .filter((a) => a.payment_id === p.id)
        .map((a) => {
          const i = f.invoices.find((i) => i.id === a.invoice_id);
          return `${i ? `MK-${i.number.padStart(8, "0")}` : "Prior customer invoice"}: ${npr(a.amount)}`;
        }),
      ...f.events
        .filter((e) => e.payment_id === p.id)
        .sort((a, b) => a.sequence - b.sequence)
        .map((e) => `${e.status} | ${e.source} | ${e.evidence}`),
      "Status is current at download time. Fonepay references alone are not proof of payment.",
    ].filter(Boolean),
  };
}
