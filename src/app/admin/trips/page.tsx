import { T } from "@/components/localization";
import { randomUUID } from "node:crypto";
import { getOperations } from "@/services/operations";
import {
  OperationsHeading,
  MigrationRequired,
} from "@/components/operations-layout";
import { AdminTripCards } from "@/components/admin-trip-cards";
import { TripHistoryFilters } from "@/components/trip-history-filters";
import { filterTrips } from "@/domain/operations/trip-presentation";
import { CreateTripForm } from "@/components/trip-forms";
import { Card } from "@/components/ui/card";
import { getTripHistory, getTripLoads } from "@/services/history";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{
    from?: string;
    to?: string;
    driver?: string;
    vehicle?: string;
    status?: string;
  }>;
}) {
  const q = await searchParams;
  const w = await getOperations(true);
  const priority = {
    ACTIVE: 0,
    LOADED: 1,
    SUBMITTED: 2,
    UNDER_REVIEW: 2,
    DISCREPANCY: 2,
    DRAFT: 3,
    CLOSED: 4,
  };
  const current = w.trips
    .filter((t) => t.status !== "CLOSED")
    .sort((a, b) => priority[a.status] - priority[b.status]);
  const history = filterTrips(
    (await getTripHistory(q.from, q.to, true)) ??
      w.trips.filter((t) => t.status === "CLOSED"),
    q,
  );
  const loads = w.available
    ? await getTripLoads([...current, ...history].map((t) => t.id))
    : [];
  return (
    <div className="space-y-5" data-testid="trips-workspace">
      <OperationsHeading
        title="Trips"
        description="Assign, load and reconcile physical stock. Closed trips retain separate visits and inventory journals."
      />
      {!w.available ? (
        <MigrationRequired />
      ) : (
        <>
          <Card className="p-4 sm:p-5" data-testid="create-trip-section">
            <details open>
              <summary className="min-h-12 cursor-pointer text-lg font-semibold">
                <T k="Create new trip" />
              </summary>
              <div className="mt-2">
                <CreateTripForm
                  workspace={w}
                  requestKey={randomUUID()}
                  id={randomUUID()}
                />
              </div>
            </details>
          </Card>
          <section className="space-y-3" aria-labelledby="current-trips">
            <h2 id="current-trips" className="text-lg font-semibold">
              <T k="Active and prepared trips" />
            </h2>
            <AdminTripCards trips={current} loads={loads} />
          </section>
          <section className="space-y-3" aria-labelledby="trip-history">
            <h2 id="trip-history" className="text-lg font-semibold">
              <T k="Trip history" />
            </h2>
            <Card className="p-4 sm:p-5">
              <TripHistoryFilters workspace={w} filters={q} />
              <p className="mt-3 text-sm text-muted-foreground">
                <T k="Filters apply to history. Current trips remain visible above. Dates use the scheduled delivery date." />
              </p>
            </Card>
            <AdminTripCards trips={history} loads={loads} />
            <p className="text-sm text-muted-foreground">
              <T k="Without a date range, the latest 100 closed trips are shown. Choose a BS date range to find older trips." />
            </p>
          </section>
        </>
      )}
    </div>
  );
}
