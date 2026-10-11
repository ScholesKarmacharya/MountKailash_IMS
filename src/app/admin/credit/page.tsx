import { creditAging } from "@/domain/finance/aging";
import Link from "next/link";
import { getFinance } from "@/services/finance";
import { getOperations } from "@/services/operations";
import { FinanceRequired } from "@/components/finance-overview";
import { npr, sum } from "@/domain/finance/money";
import { nepalDateLabel as nepalDate } from "@/domain/business-days/time";
import { Card } from "@/components/ui/card";
export default async function Page() {
  const [f, w] = await Promise.all([getFinance(true), getOperations(true)]);
  if (!f.available) return <FinanceRequired />;
  const today = nepalDate(new Date());
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Customer credit</h1>
      <p>
        Balances carry across business days. Aging uses the configured invoice
        due date and Nepal calendar date.
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        {creditAging(f.credit, today).map((b) => (
          <Card key={b.label}>
            <p className="text-sm">{b.label}</p>
            <p className="mt-3 text-xl font-bold">{npr(b.amount)}</p>
          </Card>
        ))}
      </div>
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr>
                {[
                  "Customer",
                  "Outstanding",
                  "Overdue",
                  "Deposit liability",
                  "Account",
                ].map((h) => (
                  <th key={h} className="p-3">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {w.customers.map((c) => {
                const invoices = f.credit.filter((i) => i.customer_id === c.id);
                return (
                  <tr key={c.id} className="border-t">
                    <td className="p-3">
                      <Link
                        className="text-primary underline"
                        href={"/admin/customers/" + c.id}
                      >
                        {c.name}
                      </Link>
                      {!c.is_active && " (inactive)"}
                    </td>
                    <td className="p-3">
                      {npr(sum(invoices.map((i) => i.outstanding)))}
                    </td>
                    <td className="p-3">
                      {npr(
                        sum(
                          invoices
                            .filter((i) => i.due_date && i.due_date < today)
                            .map((i) => i.outstanding),
                        ),
                      )}
                      {invoices.some((i) => !i.due_date) &&
                        " · some due dates unconfigured"}
                    </td>
                    <td className="p-3">
                      {npr(
                        sum(
                          f.deposits
                            .filter((d) => d.customer_id === c.id)
                            .map((d) => d.amount),
                        ),
                      )}
                    </td>
                    <td className="p-3">
                      {f.billing.find((b) => b.customer_id === c.id)
                        ?.account_type ?? "STANDARD"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {w.customers.length === 0 && <p>No customers registered.</p>}
        </div>
      </Card>
    </div>
  );
}
