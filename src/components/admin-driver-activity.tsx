import { T, Message, Value, LocalizedSection } from "@/components/localization";
import Link from "next/link";
import type { Trip, Workspace } from "@/domain/operations/types";
import type { FinanceWorkspace } from "@/domain/finance/types";
import { getOperations } from "@/services/operations";
import { getPendingJars } from "@/services/pending-jars";
import { roundFinance, roundLabel } from "@/domain/operations/driver-workspace";
import { npr } from "@/domain/finance/money";
import { Card } from "./ui/card";
import { ChevronDown, ArrowRight, Truck } from "lucide-react";
import { overviewRoundStock } from "@/domain/operations/admin-overview";
export async function AdminDriverActivity({
  overview,
  finance,
  day,
  openedAt,
  trips,
}: {
  overview: Workspace;
  finance: FinanceWorkspace;
  day?: string;
  openedAt?: string;
  trips: Trip[];
}) {
  if (!day || !overview.available) return null;
  const pending = await getPendingJars(true);
  const snapshots = await Promise.all(
    trips.map((t) => getOperations(true, t.id)),
  );
  return (
    <LocalizedSection aria-label="Driver activity" className="space-y-4">
      <h2 className="text-lg font-bold">
        <T k="Driver activity this business day" />
      </h2>
      {!trips.length && (
        <Card>
          <T k="No driver loads or deliveries recorded for this business day." />
        </Card>
      )}
      <div className="grid gap-4 xl:grid-cols-2">
        {trips.map((t, index) => {
          const w = snapshots[index]!;
          const s = overviewRoundStock(w, t),
            f = roundFinance(finance, t.id);
          const customers = new Set(w.visits.map((v) => v.customer_id));
          const jars = pending.rows
            .filter((r) => customers.has(r.customer_id))
            .reduce((n, r) => n + r.pending, 0);
          const added = overview.customers.filter(
            (c) =>
              c.created_by === t.driver_id &&
              c.created_at &&
              openedAt &&
              c.created_at >= openedAt,
          ).length;
          return (
            <Card
              key={t.id}
              className="min-w-0 space-y-3 p-4"
              data-testid={"overview-driver-" + t.id}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <Link
                    href={`/admin/trips/${t.id}`}
                    className="inline-flex min-h-11 items-center break-words font-semibold text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    <T
                      k="{0} · Round #{1}"
                      values={[t.driver_name, t.trip_number]}
                    />
                  </Link>
                  <p className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Truck className="size-4 shrink-0" aria-hidden="true" />
                    <T k="Assigned Vehicle: {0}" values={[t.plate_number]} />
                  </p>
                </div>
                <span
                  className={
                    "rounded-full px-2.5 py-1 text-xs font-semibold " +
                    (t.status === "ACTIVE"
                      ? "bg-teal-50 text-teal-800"
                      : ["SUBMITTED", "UNDER_REVIEW", "DISCREPANCY"].includes(
                            t.status,
                          )
                        ? "bg-amber-50 text-amber-900"
                        : "bg-muted text-muted-foreground")
                  }
                >
                  <Message
                    value={
                      t.carryover_pending
                        ? "Authorized carryover / pending settlement"
                        : roundLabel(t.status)
                    }
                  />
                </span>
              </div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-border pt-3 text-sm">
                {[
                  ["Full jars loaded", s.loadedFull],
                  ["Full jars sold", s.soldFull],
                  ["Remaining full jars", s.remainingFull],
                  ["Empty jars collected", s.collectedEmpty],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-muted-foreground">
                      <Message value={label} />
                    </dt>
                    <dd className="mt-1 text-xl font-bold tabular-nums">
                      {w.available ? (
                        <Value value={value} />
                      ) : (
                        <T k="Unavailable" />
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
              <div className="flex flex-wrap items-center justify-between gap-x-4 border-t border-border pt-1">
                <Link
                  href={"/admin/trips/" + t.id}
                  className="inline-flex min-h-11 items-center gap-2 rounded text-sm font-semibold text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <T k="View Trip Details" />
                  <ArrowRight className="size-4" aria-hidden="true" />
                </Link>
                <details className="group w-full">
                  <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-2 text-sm font-semibold text-muted-foreground">
                    <T k="More driver details" />
                    <ChevronDown
                      className="size-4 shrink-0 group-open:rotate-180"
                      aria-hidden="true"
                    />
                  </summary>
                  <dl className="grid grid-cols-2 gap-3 border-t border-border py-3 text-sm">
                    {[
                      ["Free jars delivered", s.freeFull],
                      ["Free cartons delivered", s.freeCartons],
                      ["Cartons loaded", s.loadedCartons],
                      ["Cartons sold", s.soldCartons],
                      ["Cartons remaining", s.remainingCartons],
                      ["Customer visits", s.visits],
                      ["Customers visited", s.customers],
                      ["New customers by this driver today", added],
                      [
                        "Pending jars at visited customers",
                        pending.available ? jars : "Unavailable",
                      ],
                      ["Full jars returned", s.returnedFull],
                      ["Empty jars returned", s.returnedEmpty],
                      ["Cartons returned", s.returnedCartons],
                      ["Sales", f.available ? npr(f.sales) : "Unavailable"],
                      [
                        "Cash collections",
                        f.available ? npr(f.cash) : "Unavailable",
                      ],
                      [
                        "Fonepay pending",
                        f.available ? npr(f.fonepayPending) : "Unavailable",
                      ],
                      [
                        "Fonepay verified",
                        f.available ? npr(f.fonepayVerified) : "Unavailable",
                      ],
                      [
                        "Credit issued",
                        f.available ? npr(f.creditIssued) : "Unavailable",
                      ],
                    ].map(([label, value]) => (
                      <div key={label}>
                        <dt className="text-muted-foreground">
                          <Message value={label} />
                        </dt>
                        <dd className="mt-1 font-semibold">
                          {value === "Unavailable" ? (
                            <T k="Unavailable" />
                          ) : (
                            <Value value={value} />
                          )}
                        </dd>
                      </div>
                    ))}
                  </dl>
                  <p className="text-xs text-muted-foreground">
                    <T k="New-customer count is per driver/day. Pending jars are current balances for customers visited this round and may also appear in another round." />
                  </p>
                  <Link
                    href={`/admin/trips/${t.id}#add-delivery`}
                    className="inline-block py-2 text-primary underline"
                  >
                    <T k="Inspect or perform authorized operations" />
                  </Link>
                </details>
              </div>
            </Card>
          );
        })}
      </div>
    </LocalizedSection>
  );
}
