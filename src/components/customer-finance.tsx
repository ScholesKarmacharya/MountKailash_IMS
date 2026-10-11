import Link from "next/link";
import { Card } from "./ui/card";
import type { FinanceWorkspace } from "@/domain/finance/types";
import { npr, sum } from "@/domain/finance/money";
export function CustomerFinance({
  id,
  finance: f,
}: {
  id: string;
  finance: FinanceWorkspace;
}) {
  const credit = f.credit.filter((i) => i.customer_id === id),
    deposits = f.deposits.filter((d) => d.customer_id === id),
    ledger = f.ledger.filter((l) => l.customer_id === id),
    payments = f.payments.filter((p) => p.customer_id === id);
  return (
    <Card>
      <h2 className="mb-4 font-semibold">Permanent customer finance history</h2>
      <p>
        Outstanding credit:{" "}
        <strong>{npr(sum(credit.map((i) => i.outstanding)))}</strong>
      </p>
      <p>
        Refundable deposit liability:{" "}
        <strong>{npr(sum(deposits.map((d) => d.amount)))}</strong>
      </p>
      <h3 className="mb-3 mt-6 font-semibold">Open invoices</h3>
      {credit.length === 0 && <p>No outstanding invoices.</p>}
      {credit.map((i) => (
        <p key={i.id} className="py-2">
          <Link
            className="text-primary underline"
            href={"/admin/invoices/" + i.id}
          >
            MK-{i.number.padStart(8, "0")}
          </Link>{" "}
          · {npr(i.outstanding)} · due {i.due_date ?? "unconfigured"} ·{" "}
          {npr(i.available)} available
        </p>
      ))}
      <h3 className="mb-3 mt-6 font-semibold">Receipts</h3>
      {payments.length === 0 && <p>No receipts recorded.</p>}
      {payments.map((p) => (
        <p key={p.id} className="py-2">
          <Link
            className="text-primary underline"
            href={"/admin/payments/" + p.id}
          >
            R-{p.number.padStart(8, "0")}
          </Link>{" "}
          · {p.method} · {p.status} · {npr(p.amount)}
        </p>
      ))}
      <h3 className="mb-3 mt-6 font-semibold">Receivable ledger</h3>
      {ledger.length === 0 && <p>No financial ledger entries.</p>}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr>
              <th className="p-2">Date</th>
              <th className="p-2">Entry</th>
              <th className="p-2">Charge / (settlement)</th>
            </tr>
          </thead>
          <tbody>
            {ledger.map((l) => (
              <tr key={l.id} className="border-t">
                <td className="p-2">{l.created_at}</td>
                <td className="p-2">{l.kind}</td>
                <td className="p-2">{npr(l.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h3 className="mb-3 mt-6 font-semibold">Deposit receipts and refunds</h3>
      {deposits.length === 0 && <p>No deposit transactions.</p>}
      {deposits.map((d) => (
        <p key={d.id} className="py-2">
          {d.kind} · {npr(d.amount)} · {d.reason}{" "}
          <Link
            className="text-primary underline"
            href={"/api/deposits/" + d.id + "/pdf"}
          >
            Download deposit receipt
          </Link>
        </p>
      ))}
    </Card>
  );
}
