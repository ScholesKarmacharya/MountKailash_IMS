import { notFound } from "next/navigation";
import Link from "next/link";
import { getFinance } from "@/services/finance";
import { getOperations } from "@/services/operations";
import { FinanceRequired } from "./finance-overview";
import { PaymentReview } from "./finance-admin-forms";
import { Card } from "./ui/card";
import { npr } from "@/domain/finance/money";
import { PrintButton } from "./print-button";
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
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">
        Receipt R-{p.number.padStart(8, "0")}
      </h1>
      <Card>
        <h2 className="text-xl font-bold">{p.company_snapshot.name}</h2>
        <p>{p.customer_snapshot.name}</p>
        <p>
          Business day:{" "}
          {w.days.find((d) => d.id === p.business_day_id)?.date_label}
        </p>
        <p className="mt-4 text-xl font-bold">{npr(p.amount)}</p>
        <p>
          {p.method} ·{" "}
          {p.status === "CONFIRMED"
            ? p.method === "CASH"
              ? "Cash recorded"
              : "Manually reconciled by admin"
            : p.status}
        </p>
        <p>
          Refundable deposit component: {npr(p.deposit_amount)} (separate from
          sales)
        </p>
        <p>Unverified entered reference: {p.reference || "None"}</p>
        <p className="mt-3 text-sm">
          Receipt status is current as of this page request. Pending Fonepay
          does not settle credit.
        </p>
        <div className="mt-4 flex gap-4 print:hidden">
          <PrintButton />
          <Link
            className="text-primary underline"
            href={"/api/payments/" + id + "/pdf"}
          >
            Download PDF
          </Link>
        </div>
      </Card>
      <Card>
        <h2 className="mb-4 font-semibold">Invoice allocations</h2>
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
                    MK-{i.number.padStart(8, "0")}
                  </Link>
                ) : (
                  "Prior customer invoice (outside this trip)"
                )}{" "}
                · {npr(a.amount)}
              </p>
            );
          })}
      </Card>
      <Card>
        <h2 className="mb-4 font-semibold">Immutable verification history</h2>
        {f.events
          .filter((e) => e.payment_id === id)
          .sort((a, b) => a.sequence - b.sequence)
          .map((e) => (
            <p key={e.id} className="mb-3">
              {e.status} · {e.source} · {e.evidence} · {e.created_at}
            </p>
          ))}
      </Card>
      {admin && ["PENDING", "CONFIRMED"].includes(p.status) && (
        <Card>
          <h2 className="mb-4 font-semibold">
            {p.status === "PENDING"
              ? "Explicit Fonepay reconciliation"
              : "Audited receipt reversal"}
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
