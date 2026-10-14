import { cents, decimal, sum } from "./money";
import type { FinanceWorkspace, Invoice } from "./types";
export function financeMetrics(f: FinanceWorkspace, day: string | null) {
  const lines = f.journal.filter((j) => j.business_day_id === day);
  const account = (name: string, kinds: string[]) =>
    sum(
      lines
        .filter((j) => j.account === name && kinds.includes(j.kind))
        .map((j) => j.amount),
    );
  const cash = account("CASH", ["PAYMENT", "REVERSAL"]),
    fonepay = account("FONEPAY", ["PAYMENT", "REVERSAL"]);
  const invoices = f.invoices.filter((i) =>
    f.sales.some((s) => s.id === i.sale_id && s.business_day_id === day),
  );
  let recovered = 0n;
  for (const event of f.events.filter(
    (e) =>
      e.business_day_id === day &&
      (e.status === "CONFIRMED" || e.status === "REVERSED"),
  )) {
    const p = f.payments.find((p) => p.id === event.payment_id);
    if (!p) continue;
    for (const a of f.allocations.filter((a) => {
      const invoice = f.invoices.find((i) => i.id === a.invoice_id);
      const sale = f.sales.find((s) => s.id === invoice?.sale_id);
      return a.payment_id === p.id && sale && sale.business_day_id !== day;
    }))
      recovered += cents(a.amount) * (event.status === "REVERSED" ? -1n : 1n);
  }
  return {
    sales: decimal(-cents(account("SALES", ["INVOICE", "ADJUSTMENT"]))),
    collections: sum([cash, fonepay]),
    cash,
    fonepay,
    pending: sum(
      f.payments
        .filter((p) => p.business_day_id === day && p.status === "PENDING")
        .map((p) => p.amount),
    ),
    issued: sum(
      f.issued
        .filter((c) => invoices.some((i) => i.id === c.invoice_id))
        .map((c) => c.amount),
    ),
    recovered: decimal(recovered),
    outstanding: sum(f.credit.map((c) => c.outstanding)),
    deposits: sum(f.deposits.map((d) => d.amount)),
  };
}
export function invoiceTotals(i: Invoice, f: FinanceWorkspace) {
  const changes = f.adjustments.filter((a) => a.invoice_id === i.id);
  const effective = sum([
    i.total,
    ...changes.map((a) => sum([a.subtotal_delta, a.tax_delta])),
  ]);
  return {
    effective,
    collected: decimal(cents(effective) - cents(i.outstanding)),
    pending: decimal(cents(i.outstanding) - cents(i.available)),
  };
}
export function invoicePaymentStatus(i: Invoice, f: FinanceWorkspace) {
  if (
    f.sales.find((s) => s.id === i.sale_id)?.supply_classification ===
    "FREE_SUPPLY"
  )
    return "Free Supply";
  const totals = invoiceTotals(i, f);
  if (cents(i.outstanding) === 0n) return "Paid";
  if (cents(totals.pending) > 0n) return "Pending payment";
  if (cents(totals.collected) > 0n) return "Partially paid";
  return "Credit";
}
export function invoiceDeliveries(i: Invoice, f: FinanceWorkspace) {
  const visit = f.sales.find((s) => s.id === i.sale_id)?.visit_id;
  return (f.delivery_items ?? []).filter((line) => line.visit_id === visit);
}
export function invoiceFreeValue(i: Invoice, f: FinanceWorkspace) {
  return decimal(
    f.items
      .filter(
        (s) =>
          s.sale_id === i.sale_id && s.supply_classification === "FREE_SUPPLY",
      )
      .reduce(
        (n, s) =>
          n + cents(s.reference_price_snapshot ?? "0.00") * BigInt(s.quantity),
        0n,
      ),
  );
}
