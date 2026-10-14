import type { FinanceWorkspace, Payment } from "./types";
import type { Workspace } from "@/domain/operations/types";
import { inDateRange } from "@/domain/localization/calendar";
export function paymentLabel(payment: Payment) {
  return payment.status === "CONFIRMED"
    ? payment.method === "CASH"
      ? "Cash recorded"
      : "Admin reconciled"
    : payment.status;
}
export function financeHistory(
  f: FinanceWorkspace,
  w: Workspace,
  dates: Map<string, string>,
  filters: Record<string, string | undefined>,
) {
  const driverOf = (trip: string) =>
    w.trips.find((t) => t.id === trip)?.driver_id ??
    f.sales.find((s) => s.trip_id === trip)?.driver_id;
  const payments = f.payments
    .filter(
      (p) =>
        (!filters.customer || p.customer_id === filters.customer) &&
        (!filters.driver || driverOf(p.trip_id) === filters.driver) &&
        (!filters.trip || p.trip_id === filters.trip) &&
        (!filters.method || p.method === filters.method) &&
        (!filters.status || p.status === filters.status) &&
        inDateRange(
          dates.get(p.business_day_id) ?? "",
          filters.from,
          filters.to,
          false,
        ),
    )
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const invoices = f.invoices
    .filter((i) => {
      const sale = f.sales.find((s) => s.id === i.sale_id);
      return (
        inDateRange(i.date_label, filters.from, filters.to, false) &&
        (!filters.customer || sale?.customer_id === filters.customer) &&
        (!filters.driver || sale?.driver_id === filters.driver) &&
        (!filters.trip || sale?.trip_id === filters.trip)
      );
    })
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  return { payments, invoices };
}
