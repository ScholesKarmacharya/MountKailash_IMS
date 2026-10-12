import Link from "next/link";
import { Card } from "./ui/card";
import { formatNepalTime } from "@/domain/business-days/time";
import type { PendingJarWorkspace } from "@/domain/operations/pending-jars";
export function PendingJars({
  workspace,
  admin = false,
  title = "Pending Jars",
}: {
  workspace: PendingJarWorkspace;
  admin?: boolean;
  title?: string;
}) {
  return (
    <Card id="pending-jars" className="space-y-4">
      <h2 className="font-semibold">{title}</h2>
      {!workspace.available ? (
        <p role="status">
          The Sprint 6 pending-jar migration is required before dated balances
          can load.
        </p>
      ) : (
        <>
          <p>
            <strong>
              {workspace.rows.reduce((n, r) => n + r.pending, 0)} pending jars
            </strong>
          </p>
          <p className="text-sm text-muted-foreground">
            Empty returns settle the oldest outstanding jars first. Original
            delivery dates carry forward; financial credit is separate.
          </p>
          {!workspace.rows.length && <p>No pending jars.</p>}
          <ul className="divide-y divide-border">
            {workspace.rows.map((r) => (
              <li key={r.entry_id} className="space-y-1 py-3 text-sm">
                {admin ? (
                  <Link
                    className="font-semibold text-primary underline"
                    href={`/admin/customers/${r.customer_id}`}
                  >
                    {r.customer_name}
                  </Link>
                ) : (
                  <p className="font-semibold">{r.customer_name}</p>
                )}
                <p>
                  {r.pending} outstanding of {r.quantity} {r.product_name}
                </p>
                <p>
                  Original date: {formatNepalTime(r.original_date)} · business
                  day {r.business_date}
                </p>
                {r.source !== "Delivery" && (
                  <p className="text-muted-foreground">
                    {r.source}; this date is the correction date.
                  </p>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}
