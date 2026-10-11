import { randomUUID } from "node:crypto";
import { getOperations } from "@/services/operations";
import {
  OperationsHeading,
  MigrationRequired,
} from "@/components/operations-layout";
import { TripList } from "@/components/trip-summary";
import { CreateTripForm } from "@/components/trip-forms";
import { Card } from "@/components/ui/card";
export default async function Page() {
  const w = await getOperations(true);
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
          <TripList trips={w.trips} admin />
          <Card>
            <h2 className="mb-5 text-lg font-semibold">Create trip</h2>
            <CreateTripForm
              workspace={w}
              requestKey={randomUUID()}
              id={randomUUID()}
            />
          </Card>
          <p className="text-xs text-muted-foreground">
            All open trips and the latest 100 closed trips are listed. Older
            trip links remain accessible.
          </p>
        </>
      )}
    </div>
  );
}
