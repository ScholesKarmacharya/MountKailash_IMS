import Link from "next/link";
import { randomUUID } from "node:crypto";
import { getOperations } from "@/services/operations";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  MigrationRequired,
  OperationsHeading,
} from "@/components/operations-layout";
import { StockCards, TripList } from "@/components/trip-summary";
import { OperationForm } from "@/components/operation-form";
export default async function DriverHome() {
  const overview = await getOperations(false);
  const trip = overview.trips.find((t) => t.status !== "CLOSED");
  const w = trip ? await getOperations(false, trip.id) : overview;
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <OperationsHeading
        title="My day"
        description="Your trip, stock and deliveries."
      />
      {!w.available ? (
        <MigrationRequired />
      ) : trip ? (
        <>
          <Card className="space-y-4">
            <p className="text-xs font-semibold uppercase tracking-widest text-primary">
              Assigned trip
            </p>
            <h2 className="text-2xl font-bold">
              Trip #{trip.trip_number} · {trip.plate_number}
            </h2>
            <p className="text-sm text-muted-foreground">
              Business day {trip.date_label} ·{" "}
              {trip.status.replaceAll("_", " ")}
            </p>
            {trip.status === "ACTIVE" ? (
              <Button asChild className="min-h-14 w-full text-lg">
                <Link href={`/driver/trips/${trip.id}#add-delivery`}>
                  Add Delivery
                </Link>
              </Button>
            ) : trip.status === "LOADED" ? (
              <OperationForm
                operation="start"
                trip={trip.id}
                requestKey={randomUUID()}
                label="Start trip"
                confirm="Start this loaded trip?"
              />
            ) : (
              <p className="text-sm">
                {trip.status === "DRAFT"
                  ? "Your admin is preparing the vehicle load."
                  : "Your submitted counts await warehouse verification."}
              </p>
            )}
            <Link
              className="inline-block py-3 font-semibold text-primary underline"
              href={`/driver/trips/${trip.id}`}
            >
              View trip / return counts
            </Link>
          </Card>
          {w.loads.length > 0 && (
            <>
              <h2 className="font-semibold">Remaining vehicle stock</h2>
              <StockCards workspace={w} trip={trip} />
            </>
          )}
        </>
      ) : (
        <Card>
          <h2 className="font-semibold">No assigned trip</h2>
          <p className="mt-3 text-sm text-muted-foreground">
            Your admin will assign a driver, vehicle and load before you can
            record deliveries.
          </p>
        </Card>
      )}
      {overview.available && (
        <>
          <h2 className="font-semibold">Recent trips</h2>
          <TripList
            trips={overview.trips.filter((t) => t.status === "CLOSED")}
            admin={false}
          />
        </>
      )}
      <p className="text-xs text-muted-foreground">
        Payments remain unverified until Sprint 3. Your return declaration
        requires warehouse approval.
      </p>
    </div>
  );
}
