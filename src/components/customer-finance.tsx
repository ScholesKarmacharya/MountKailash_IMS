"use client";
import { useState } from "react";
import { BsDateRange } from "./bs-date-picker";
import { inDateRange } from "@/domain/localization/calendar";
import { T, Message, DateValue, Value } from "@/components/localization";
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
  const [range, setRange] = useState({ from: "", to: "" });
  const credit = f.credit.filter((i) => i.customer_id === id),
    allDeposits = f.deposits.filter((d) => d.customer_id === id),
    deposits = allDeposits.filter((d) =>
      inDateRange(d.created_at, range.from, range.to),
    ),
    ledger = f.ledger.filter(
      (l) =>
        l.customer_id === id && inDateRange(l.created_at, range.from, range.to),
    ),
    payments = f.payments.filter(
      (p) =>
        p.customer_id === id && inDateRange(p.created_at, range.from, range.to),
    );
  return (
    <Card>
      <h2 className="mb-4 font-semibold">
        <T k="Permanent customer finance history" />
      </h2>
      <p>
        {" "}
        <T k="Outstanding credit:" />{" "}
        <strong>
          <Value value={npr(sum(credit.map((i) => i.outstanding)))} />
        </strong>
      </p>
      <p>
        {" "}
        <T k="Refundable deposit liability:" />{" "}
        <strong>
          <Value value={npr(sum(allDeposits.map((d) => d.amount)))} />
        </strong>
      </p>
      <BsDateRange onChange={(from, to) => setRange({ from, to })} />
      <h3 className="mb-3 mt-6 font-semibold">
        <T k="Open invoices" />
      </h3>
      {credit.length === 0 && (
        <p>
          <T k="No outstanding invoices." />
        </p>
      )}
      {credit.map((i) => (
        <p key={i.id} className="py-2">
          <Link
            className="text-primary underline"
            href={"/admin/invoices/" + i.id}
          >
            <T k="MK-{0}" values={[i.number.padStart(8, "0")]} />
          </Link>{" "}
          <T
            k="Outstanding since {0}"
            values={[<DateValue key="date" value={i.date_label} />]}
          />{" "}
          · <Value value={npr(i.outstanding)} /> <T k="· due" />{" "}
          <DateValue value={i.due_date ?? "unconfigured"} /> ·{" "}
          <Value value={npr(i.available)} /> <T k="available" />{" "}
        </p>
      ))}
      <h3 className="mb-3 mt-6 font-semibold">
        <T k="Receipts" />
      </h3>
      {payments.length === 0 && (
        <p>
          <T k="No receipts recorded." />
        </p>
      )}
      {payments.map((p) => (
        <p key={p.id} className="py-2">
          <Link
            className="text-primary underline"
            href={"/admin/payments/" + p.id}
          >
            <T k="R-{0}" values={[p.number.padStart(8, "0")]} />
          </Link>{" "}
          · <Message value={p.method} /> · <Message value={p.status} /> ·{" "}
          <Value value={npr(p.amount)} /> ·{" "}
          <DateValue value={p.created_at} time />
        </p>
      ))}
      <h3 className="mb-3 mt-6 font-semibold">
        <T k="Receivable ledger" />
      </h3>
      {ledger.length === 0 && (
        <p>
          <T k="No financial ledger entries." />
        </p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr>
              <th className="p-2">
                <T k="Date" />
              </th>
              <th className="p-2">
                <T k="Entry" />
              </th>
              <th className="p-2">
                <T k="Charge / (settlement)" />
              </th>
            </tr>
          </thead>
          <tbody>
            {ledger.map((l) => (
              <tr key={l.id} className="border-t">
                <td className="p-2">
                  <DateValue value={l.created_at} time />
                </td>
                <td className="p-2">
                  <Message value={l.kind} />
                </td>
                <td className="p-2">
                  <Value value={npr(l.amount)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h3 className="mb-3 mt-6 font-semibold">
        <T k="Deposit receipts and refunds" />
      </h3>
      {deposits.length === 0 && (
        <p>
          <T k="No deposit transactions." />
        </p>
      )}
      {deposits.map((d) => (
        <p key={d.id} className="py-2">
          <Message value={d.kind} /> · <Value value={npr(d.amount)} /> ·{" "}
          {d.reason} · <DateValue value={d.created_at} time />{" "}
          <Link
            className="text-primary underline"
            href={"/api/deposits/" + d.id + "/pdf"}
          >
            <T k="Download deposit receipt" />
          </Link>
        </p>
      ))}
    </Card>
  );
}
