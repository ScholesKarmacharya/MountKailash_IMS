import { T } from "@/components/localization";
import { randomUUID } from "node:crypto";
import { getOperations } from "@/services/operations";
import {
  OperationsHeading,
  MigrationRequired,
} from "@/components/operations-layout";
import { TripList } from "@/components/trip-summary";
import { CreateTripForm } from "@/components/trip-forms";
import { Card } from "@/components/ui/card";
import { getTripHistory } from "@/services/history";
import { BsDateRange } from "@/components/bs-date-picker";
import { Button } from "@/components/ui/button";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const q = await searchParams;
  const w = await getOperations(true);
  const trips = (await getTripHistory(q.from, q.to, true)) ?? w.trips;
  return (
    <div className="space-y-6">
      <OperationsHeading
        title="Trips"
        description="Assign, load and reconcile physical stock. Closed trips retain separate visits and inventory journals."
      />
      {!w.available ? (
        <MigrationRequired />
      ) : (
        <>
          <form className="space-y-3">
            <BsDateRange from={q.from} to={q.to} />
            <Button type="submit">
              <T k="Filter history" />
            </Button>
          </form>
          <TripList trips={trips} admin />
          <Card>
            <h2 className="mb-5 text-lg font-semibold">
              <T k="Create trip" />
            </h2>
            <CreateTripForm
              workspace={w}
              requestKey={randomUUID()}
              id={randomUUID()}
            />
          </Card>
          <p className="text-xs text-muted-foreground">
            <T k="All open trips and the latest 100 closed trips are listed. Older trip links remain accessible." />
          </p>
        </>
      )}
    </div>
  );
}
