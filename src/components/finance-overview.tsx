import { Card } from "./ui/card";
import { financeMetrics } from "@/domain/finance/reports";
import { npr } from "@/domain/finance/money";
import type { FinanceWorkspace } from "@/domain/finance/types";
export function FinanceRequired() {
  return (
    <Card>
      <h2 className="font-semibold">Finance migration required</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Apply the reviewed Sprint 3 migrations before recording sales,
        settlements, credit and deposits. Existing trip and stock records remain
        available.
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
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {[
        ["Business-day sales", m.sales],
        ["Actual collections", m.collections],
        ["Cash recorded", m.cash],
        ["Admin-reconciled Fonepay", m.fonepay],
        ["Pending Fonepay", m.pending],
        ["New credit issued", m.issued],
        ["Previous credit recovered", m.recovered],
        ["All outstanding credit", m.outstanding],
        ["Refundable deposit liability", m.deposits],
      ].map(([label, value]) => (
        <Card key={label}>
          <h2 className="text-sm text-muted-foreground">{label}</h2>
          <p className="mt-3 text-xl font-bold">{npr(value!)}</p>
        </Card>
      ))}
    </div>
  );
}
