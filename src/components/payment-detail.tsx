import { T, Message, DateValue, Value } from "@/components/localization";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getFinance } from "@/services/finance";
import { getOperations } from "@/services/operations";
import { FinanceRequired } from "./finance-overview";
import { PaymentReview } from "./finance-admin-forms";
import { Card } from "./ui/card";
import { npr } from "@/domain/finance/money";
import { PrintButton } from "./print-button";
import { readBusinessDate } from "@/data-access/business-days";
export async function PaymentDetail({
  id,
  admin,
}: {
  id: string;
  admin: boolean;
}) {
  const [f, w] = await Promise.all([getFinance(admin), getOperations(admin)]);
  if (!f.available) return <FinanceRequired />;
  const p = f.payments.find((p) => p.id === id);
  if (!p) notFound();
  const businessDate =
    w.days.find((d) => d.id === p.business_day_id)?.date_label ??
    (await readBusinessDate(p.business_day_id));
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">
        <T k="Receipt R-{0}" values={[p.number.padStart(8, "0")]} />
      </h1>
      <Card>
        <h2 className="text-xl font-bold">{p.company_snapshot.name}</h2>
        <p>{p.customer_snapshot.name}</p>
        <p>
          <T
            k="Business day: {0}"
            values={[<DateValue key="v0" value={businessDate} />]}
          />
        </p>
        <p>
          <T
            k="Payment date: {0}"
            values={[
              <DateValue key="payment-date" value={p.created_at} time />,
            ]}
          />
        </p>
        <p className="mt-4 text-xl font-bold">
          <Value value={npr(p.amount)} />
        </p>
        <p>
          <Message value={p.method} /> ·{" "}
          <Message
            value={
              p.status === "CONFIRMED"
                ? p.method === "CASH"
                  ? "Cash recorded"
                  : "Manually reconciled by admin"
                : p.status
            }
          />
        </p>
        <p>
          <T
            k="Refundable deposit component: {0} (separate from sales)"
            values={[<Value key="v0" value={npr(p.deposit_amount)} />]}
          />
        </p>
        <p>
          <T
            k="Unverified entered reference: {0}"
            values={[p.reference || "None"]}
          />
        </p>
        <p className="mt-3 text-sm">
          <T k="Receipt status is current as of this page request. Pending Fonepay does not settle credit." />
        </p>
        <div className="mt-4 flex gap-4 print:hidden">
          <PrintButton />
          <Link
            className="text-primary underline"
            href={"/api/payments/" + id + "/pdf"}
          >
            <T k="Download PDF" />
          </Link>
        </div>
      </Card>
      <Card>
        <h2 className="mb-4 font-semibold">
          <T k="Invoice allocations" />
        </h2>
        {f.allocations
          .filter((a) => a.payment_id === id)
          .map((a) => {
            const i = f.invoices.find((i) => i.id === a.invoice_id);
            return (
              <p key={a.id}>
                {i ? (
                  <Link
                    href={(admin ? "/admin" : "/driver") + "/invoices/" + i.id}
                    className="text-primary underline"
                  >
                    <T k="MK-{0}" values={[i.number.padStart(8, "0")]} />
                  </Link>
                ) : (
                  "Prior customer invoice (outside this trip)"
                )}{" "}
                · <Value value={npr(a.amount)} />
              </p>
            );
          })}
      </Card>
      <Card>
        <h2 className="mb-4 font-semibold">
          <T k="Immutable verification history" />
        </h2>
        {f.events
          .filter((e) => e.payment_id === id)
          .sort((a, b) => a.sequence - b.sequence)
          .map((e) => (
            <p key={e.id} className="mb-3">
              <Message value={e.status} /> · <Message value={e.source} /> ·{" "}
              {e.evidence} · <DateValue value={e.created_at} time />
            </p>
          ))}
      </Card>
      {admin && ["PENDING", "CONFIRMED"].includes(p.status) && (
        <Card>
          <h2 className="mb-4 font-semibold">
            <Message
              value={
                p.status === "PENDING"
                  ? "Explicit Fonepay reconciliation"
                  : "Audited receipt reversal"
              }
            />
          </h2>
          <PaymentReview
            payment={p}
            day={w.days.find((d) => d.status === "OPEN")?.id ?? null}
          />
        </Card>
      )}
    </div>
  );
}
