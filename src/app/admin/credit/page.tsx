import Link from "next/link";
import { T, Message, Value } from "@/components/localization";
import { creditAging } from "@/domain/finance/aging";
import { getFinance } from "@/services/finance";
import { getOperations } from "@/services/operations";
import { FinanceRequired } from "@/components/finance-overview";
import { npr, sum } from "@/domain/finance/money";
import { nepalDateLabel } from "@/domain/business-days/time";
import { CreditStatement } from "@/components/credit-statement";
import { ReportPanel, ReportTable, MetricGrid } from "@/components/report-ui";
import { Button } from "@/components/ui/button";
import { OperationsHeading } from "@/components/operations-layout";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ customer?: string }>;
}) {
  const [f, w, q] = await Promise.all([
    getFinance(true),
    getOperations(true),
    searchParams,
  ]);
  if (!f.available) return <FinanceRequired />;
  const today = nepalDateLabel(new Date());
  return (
    <div className="space-y-5" data-testid="credit-workspace">
      <OperationsHeading
        title="Customer credit"
        description="Balances carry across business days. Aging uses the configured invoice due date and Nepal calendar date."
      />
      <CreditStatement
        key={q.customer ?? ""}
        initialCustomer={q.customer}
        finance={f}
        customers={w.customers}
      />
      <ReportPanel
        title="Receivable aging"
        description="Customer jars and refundable deposits are separate from this credit statement."
        testId="credit-aging"
      >
        <MetricGrid
          items={creditAging(f.credit, today).map((b) => ({
            label: b.label,
            value: npr(b.amount),
          }))}
        />
      </ReportPanel>
      <ReportPanel title="Customer account summary">
        <ReportTable
          columns={[
            "Customer",
            "Outstanding",
            "Overdue",
            "Deposit liability",
            "Account",
            "Actions",
          ]}
          empty="No customers registered."
          rows={w.customers.map((c) => {
            const invoices = f.credit.filter((i) => i.customer_id === c.id);
            return {
              id: c.id,
              cells: [
                <span key="customer">
                  {c.name}
                  {!c.is_active && <T k=" (inactive)" />}
                </span>,
                <Value
                  key="outstanding"
                  value={npr(sum(invoices.map((i) => i.outstanding)))}
                />,
                <div key="overdue">
                  <Value
                    value={npr(
                      sum(
                        invoices
                          .filter((i) => i.due_date && i.due_date < today)
                          .map((i) => i.outstanding),
                      ),
                    )}
                  />
                  {invoices.some((i) => !i.due_date) && (
                    <p className="mt-1 text-xs text-amber-900">
                      <T k="Due unconfigured" />
                    </p>
                  )}
                </div>,
                <Value
                  key="deposit"
                  value={npr(
                    sum(
                      f.deposits
                        .filter((d) => d.customer_id === c.id)
                        .map((d) => d.amount),
                    ),
                  )}
                />,
                <Message
                  key="type"
                  value={
                    f.billing.find((b) => b.customer_id === c.id)
                      ?.account_type ?? "STANDARD"
                  }
                />,
                <Button key="view" asChild variant="outline">
                  <Link href={`/admin/credit?customer=${c.id}`}>
                    <T k="View statement" />
                  </Link>
                </Button>,
              ],
            };
          })}
        />
      </ReportPanel>
    </div>
  );
}
