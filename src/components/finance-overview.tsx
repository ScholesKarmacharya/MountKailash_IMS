import { T } from "@/components/localization";
import { Card } from "./ui/card";
import { financeMetrics } from "@/domain/finance/reports";
import { npr, sum, cents, decimal } from "@/domain/finance/money";
import { MetricGrid, ReportPanel } from "./report-ui";
import type { FinanceWorkspace } from "@/domain/finance/types";
export function FinanceRequired() {
  return (
    <Card>
      <h2 className="font-semibold">
        <T k="Finance migration required" />
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">
        <T k="Apply the reviewed Sprint 3 migrations before recording sales, settlements, credit and deposits. Existing trip and stock records remain available." />
      </p>
    </Card>
  );
}
export function FinanceOverview({
  finance: f,
  day,
}: {
  finance: FinanceWorkspace;
  day: string | null;
}) {
  if (!f.available) return <FinanceRequired />;
  const m = financeMetrics(f, day);
  return (
    <div className="space-y-4" data-testid="finance-overview">
      <MetricGrid
        items={[
          ["Business-day sales", m.sales],
          ["Confirmed collections", m.collections],
          ["New credit issued", m.issued],
          ["All outstanding credit", m.outstanding],
          ["Pending Fonepay", m.pending],
          ["Refundable deposit liability", m.deposits],
        ].map(([label, value]) => ({
          label: label!,
          value: npr(value!),
          hint: [
            "All outstanding credit",
            "Refundable deposit liability",
          ].includes(label!)
            ? "Current cumulative balance"
            : "Selected business day",
        }))}
      />
      <ReportPanel
        title="Collections and deposit breakdown"
        description="Collections include credit recovery and deposits. Deposits are separate from sales."
      >
        <MetricGrid
          compact
          items={[
            ["Cash recorded", m.cash],
            ["Admin-reconciled Fonepay", m.fonepay],
            ["Previous credit recovered", m.recovered],
            ...(["RECEIPT", "REVERSAL", "REFUND"] as const).map((kind, i) => [
              ["Deposits received", "Deposits reversed", "Deposits refunded"][
                i
              ]!,
              i === 0
                ? sum(
                    f.deposits
                      .filter(
                        (d) => d.business_day_id === day && d.kind === kind,
                      )
                      .map((d) => d.amount),
                  )
                : decimal(
                    -cents(
                      sum(
                        f.deposits
                          .filter(
                            (d) => d.business_day_id === day && d.kind === kind,
                          )
                          .map((d) => d.amount),
                      ),
                    ),
                  ),
            ]),
          ].map(([label, value]) => ({ label: label!, value: npr(value!) }))}
        />
        <MetricGrid
          compact
          items={[
            {
              label: "Pending receipts",
              value: f.payments.filter(
                (p) => p.business_day_id === day && p.status === "PENDING",
              ).length,
            },
            {
              label: "Rejected receipts",
              value: f.payments.filter(
                (p) => p.business_day_id === day && p.status === "REJECTED",
              ).length,
            },
          ]}
        />
      </ReportPanel>
    </div>
  );
}
