import Link from "next/link";
import { Card } from "./ui/card";
import { formatNepalTime } from "@/domain/business-days/time";
import type { PendingJarWorkspace } from "@/domain/operations/pending-jars";
import { pendingDays } from "@/domain/operations/pending-age";
export function PendingJars({
  workspace,
  admin = false,
  title = "Pending Jars",
  asOf,
}: {
  workspace: PendingJarWorkspace;
  admin?: boolean;
  title?: string;
  asOf?: string | null;
}) {
  return (
    <Card id="pending-jars" className="space-y-4">
      <h2 className="font-semibold">{title}</h2>
      {!workspace.available ? (
        <p role="status">
          The pending-jar or driver lookup migration is required before these
          dated balances can load.
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
                <p>
                  {pendingDays(
                    r.original_date,
                    asOf ? new Date(asOf) : new Date(),
                  )}{" "}
                  days pending
                  {r.trip_number != null && ` · Round #${r.trip_number}`}
                  {r.driver_name && ` · ${r.driver_name}`}
                </p>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}
