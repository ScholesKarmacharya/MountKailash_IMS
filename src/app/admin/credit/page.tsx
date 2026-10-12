import { T, Message, Value } from "@/components/localization";
import { creditAging } from "@/domain/finance/aging";
import Link from "next/link";
import { getFinance } from "@/services/finance";
import { getOperations } from "@/services/operations";
import { FinanceRequired } from "@/components/finance-overview";
import { npr, sum } from "@/domain/finance/money";
import { nepalDateLabel as nepalDate } from "@/domain/business-days/time";
import { Card } from "@/components/ui/card";
import { CreditStatement } from "@/components/credit-statement";
export default async function Page() {
  const [f, w] = await Promise.all([getFinance(true), getOperations(true)]);
  if (!f.available) return <FinanceRequired />;
  const today = nepalDate(new Date());
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">
        <T k="Customer credit" />
      </h1>
      <CreditStatement finance={f} customers={w.customers} />
      <p>
        <T k="Balances carry across business days. Aging uses the configured invoice due date and Nepal calendar date." />
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        {creditAging(f.credit, today).map((b) => (
          <Card key={b.label}>
            <p className="text-sm">
              <Message value={b.label} />
            </p>
            <p className="mt-3 text-xl font-bold">
              <Value value={npr(b.amount)} />
            </p>
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
                    <Message value={h} />
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
                      {!c.is_active && <T k=" (inactive)" />}
                    </td>
                    <td className="p-3">
                      <Value
                        value={npr(sum(invoices.map((i) => i.outstanding)))}
                      />
                    </td>
                    <td className="p-3">
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
                        <T k=" · some due dates unconfigured" />
                      )}
                    </td>
                    <td className="p-3">
                      <Value
                        value={npr(
                          sum(
                            f.deposits
                              .filter((d) => d.customer_id === c.id)
                              .map((d) => d.amount),
                          ),
                        )}
                      />
                    </td>
                    <td className="p-3">
                      <Message
                        value={
                          f.billing.find((b) => b.customer_id === c.id)
                            ?.account_type ?? "STANDARD"
                        }
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {w.customers.length === 0 && (
            <p>
              <T k="No customers registered." />
            </p>
          )}
        </div>
      </Card>
    </div>
  );
}
