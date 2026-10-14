import type { DayReport } from "@/domain/business-days/types";
import { amountLabels } from "@/domain/business-days/reports";
import { npr } from "@/domain/finance/money";
import { MetricGrid, ReportPanel } from "./report-ui";
import { T } from "./localization";
export function ClosingFinanceSummary({ report: r }: { report: DayReport }) {
  const metrics = (keys: (keyof typeof amountLabels)[]) =>
    keys.map((key) => ({
      label: amountLabels[key],
      value: npr(r.totals[key]),
    }));
  return (
    <ReportPanel title="Closing financial summary" testId="closing-finance">
      <MetricGrid
        items={[
          ...(r.totals.paid_sales !== undefined
            ? [{ label: "Paid sales", value: npr(r.totals.paid_sales) }]
            : []),
          ...metrics([
            "sales",
            "gross_sales",
            "collections",
            "new_credit",
            "outstanding",
          ]),
        ]}
      />
      <h3 className="font-semibold">
        <T k="Collections and tax breakdown" />
      </h3>
      <MetricGrid
        compact
        items={metrics([
          "tax",
          "cash",
          "fonepay",
          "pending_fonepay",
          "cash_net",
          "old_credit_recovered",
        ])}
      />
      <h3 className="font-semibold">
        <T k="Refundable deposits" />
      </h3>
      <MetricGrid
        compact
        items={metrics([
          "deposits_received",
          "deposits_reversed",
          "deposits_refunded",
          "deposit_liability",
        ])}
      />
      {r.totals.free_supply_value !== undefined && (
        <div className="space-y-3 border-t border-border pt-4">
          <h3 className="font-semibold">
            <T k="Free Supply" />
          </h3>
          <MetricGrid
            compact
            items={[
              { label: "Total Free Jars", value: r.totals.free_jars ?? 0 },
              {
                label: "Total Free Cartons",
                value: r.totals.free_cartons ?? 0,
              },
              {
                label: "Value of Free Supply",
                value: npr(r.totals.free_supply_value),
              },
              {
                label: "Reference value adjustments",
                value: npr(r.totals.free_supply_adjustments ?? "0.00"),
              },
            ]}
          />
          <p className="text-sm text-muted-foreground">
            <T k="Reference value only; excluded from revenue and customer credit." />
          </p>
        </div>
      )}
    </ReportPanel>
  );
}
