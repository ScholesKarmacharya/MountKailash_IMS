import Link from "next/link";
import { T, Message, DateValue, Value } from "@/components/localization";
import { getFinance } from "@/services/finance";
import { getOperations } from "@/services/operations";
import { getDayHistory } from "@/services/business-days";
import {
  FinanceOverview,
  FinanceRequired,
} from "@/components/finance-overview";
import { FinanceFilters } from "@/components/finance-filters";
import { ReportPanel, ReportTable } from "@/components/report-ui";
import { OperationsHeading } from "@/components/operations-layout";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { npr } from "@/domain/finance/money";
import { invoiceTotals, invoicePaymentStatus } from "@/domain/finance/reports";
import { financeHistory, paymentLabel } from "@/domain/finance/presentation";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const [f, w, q] = await Promise.all([
    getFinance(true),
    getOperations(true),
    searchParams,
  ]);
  if (!f.available) return <FinanceRequired />;
  const history = await getDayHistory(),
    dates = new Map(history.days.map((d) => [d.id, d.date_label]));
  const day = history.days.some((d) => d.id === q.day)
    ? q.day!
    : (w.days.find((d) => d.status !== "CLOSED")?.id ??
      history.days[0]?.id ??
      null);
  const { payments, invoices } = financeHistory(f, w, dates, q);
  return (
    <div className="space-y-5" data-testid="payments-workspace">
      <OperationsHeading
        title="Payments"
        description="Sales, confirmed collections and customer balances. Fonepay requires explicit admin reconciliation."
      />
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <T k="Overview business day" />:{" "}
        <strong>
          <DateValue value={day ? dates.get(day) : null} />
        </strong>
      </div>
      <FinanceOverview finance={f} day={day} />
      <ReportPanel
        title="Payment history filters"
        description="The overview uses the selected business day. Date, customer, driver and trip filters apply to both lists; method and status apply to receipts."
      >
        <FinanceFilters
          workspace={w}
          days={history.days}
          filters={q}
          day={day}
        />
      </ReportPanel>
      <ReportPanel title="Receipts" testId="receipts-section">
        <ReportTable
          testId="receipt-list"
          columns={[
            "Receipt",
            "Customer",
            "Business date",
            "Method",
            "Status",
            "Amount",
            "Deposit",
            "Actions",
          ]}
          empty="No payments match these filters."
          rows={payments.map((p) => ({
            id: p.id,
            cells: [
              <span key="number" className="font-semibold">
                <T k="R-{0}" values={[p.number.padStart(8, "0")]} />
              </span>,
              p.customer_snapshot?.name ||
                w.customers.find((c) => c.id === p.customer_id)?.name || (
                  <T key="customer" k="Walk-in" />
                ),
              <DateValue key="date" value={dates.get(p.business_day_id)} />,
              <Message key="method" value={p.method} />,
              <StatusBadge
                key="status"
                label={paymentLabel(p)}
                tone={
                  p.status === "CONFIRMED"
                    ? "positive"
                    : p.status === "PENDING" || p.status === "REJECTED"
                      ? "warning"
                      : "neutral"
                }
              />,
              <Value key="amount" value={npr(p.amount)} />,
              <Value key="deposit" value={npr(p.deposit_amount)} />,
              <Button key="view" asChild variant="outline">
                <Link href={`/admin/payments/${p.id}`}>
                  <T k="View receipt" />
                </Link>
              </Button>,
            ],
          }))}
        />
      </ReportPanel>
      <ReportPanel title="Invoices" testId="invoices-section">
        <ReportTable
          testId="invoice-list"
          columns={[
            "Invoice",
            "Customer",
            "Business date",
            "Total amount",
            "Paid amount",
            "Outstanding",
            "Status",
            "Actions",
          ]}
          empty="No invoices match these filters."
          rows={invoices.map((i) => {
            const totals = invoiceTotals(i, f),
              status = invoicePaymentStatus(i, f);
            return {
              id: i.id,
              cells: [
                <span key="number" className="font-semibold">
                  <T k="MK-{0}" values={[i.number.padStart(8, "0")]} />
                </span>,
                i.customer.name,
                <DateValue key="date" value={i.date_label} />,
                <Value key="total" value={npr(totals.effective)} />,
                <Value key="paid" value={npr(totals.collected)} />,
                <Value key="outstanding" value={npr(i.outstanding)} />,
                <StatusBadge
                  key="status"
                  label={status}
                  tone={
                    status === "Paid" || status === "Free Supply"
                      ? "positive"
                      : "warning"
                  }
                />,
                <Button key="view" asChild variant="outline">
                  <Link href={`/admin/invoices/${i.id}`}>
                    <T k="View invoice" />
                  </Link>
                </Button>,
              ],
            };
          })}
        />
      </ReportPanel>
      <ReportPanel title="Immutable finance audit journal" collapsed>
        <ReportTable
          columns={[
            "Business date",
            "Kind",
            "Account",
            "Amount",
            "Source ID",
            "Posting ID",
          ]}
          empty="No finance postings recorded."
          rows={f.journal.map((j) => ({
            id: j.id,
            cells: [
              <DateValue key="date" value={dates.get(j.business_day_id)} />,
              <Message key="kind" value={j.kind} />,
              <Message key="account" value={j.account} />,
              <Value key="amount" value={npr(j.amount)} />,
              <span key="source" className="break-all">
                {j.source_id}
              </span>,
              <span key="posting" className="break-all">
                {j.posting_id}
              </span>,
            ],
          }))}
        />
      </ReportPanel>
    </div>
  );
}
