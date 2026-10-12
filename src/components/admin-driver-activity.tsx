import { T, Message, Value, LocalizedSection } from "@/components/localization";
import Link from "next/link";
import type { Workspace } from "@/domain/operations/types";
import type { FinanceWorkspace } from "@/domain/finance/types";
import { getOperations } from "@/services/operations";
import { getPendingJars } from "@/services/pending-jars";
import {
  roundStock,
  roundFinance,
  roundLabel,
} from "@/domain/operations/driver-workspace";
import { npr } from "@/domain/finance/money";
import { Card } from "./ui/card";
export async function AdminDriverActivity({
  overview,
  finance,
  day,
  openedAt,
}: {
  overview: Workspace;
  finance: FinanceWorkspace;
  day?: string;
  openedAt?: string;
}) {
  if (!day || !overview.available) return null;
  const trips = overview.trips.filter((t) => t.business_day_id === day);
  const pending = await getPendingJars(true);
  const snapshots = await Promise.all(
    trips.map((t) => getOperations(true, t.id)),
  );
  return (
    <LocalizedSection aria-label="Driver activity" className="space-y-4">
      <h2 className="text-xl font-bold">
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
          const s = roundStock(w, t),
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
            <Card key={t.id} className="space-y-4">
              <div>
                <Link
                  href={`/admin/trips/${t.id}`}
                  className="font-semibold text-primary underline"
                >
                  <T
                    k="{0} · Round #{1}"
                    values={[t.driver_name, t.trip_number]}
                  />
                </Link>
                <p className="mt-2 text-sm">
                  <T
                    k="Assigned Vehicle: {0} · {1}"
                    values={[
                      t.plate_number,
                      <Message key="v1" value={roundLabel(t.status)} />,
                    ]}
                  />
                </p>
              </div>
              <dl className="grid grid-cols-2 gap-3 text-sm">
                {[
                  ["Full jars loaded", s.loadedFull],
                  ["Full jars sold", s.soldFull],
                  ["Remaining full jars", s.remainingFull],
                  ["Empty jars collected", s.collectedEmpty],
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
            </Card>
          );
        })}
      </div>
    </LocalizedSection>
  );
}
