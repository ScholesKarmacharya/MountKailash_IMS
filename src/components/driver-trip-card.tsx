"use client";
import Link from "next/link";
import type { DriverData } from "./driver-application";
import { roundLabel } from "@/domain/operations/driver-workspace";
import { T, Message, Value, DateValue } from "./localization";
import { Card } from "./ui/card";
import { OperationForm } from "./operation-form";
import { StartTripAction } from "./start-trip-action";

export function DriverTripCard({
  data,
  primary = true,
}: {
  data: DriverData;
  primary?: boolean;
}) {
  const trip = data.trip;
  if (!trip)
    return (
      <Card className="space-y-2">
        <h2 className="font-semibold">
          <T k="Waiting for warehouse loading" />
        </h2>
        <p className="text-sm text-muted-foreground">
          <T k="Your next trip will appear here." />
        </p>
      </Card>
    );
  const scheduled = trip.scheduled_date ?? trip.date_label;
  const returned = ["SUBMITTED", "UNDER_REVIEW", "DISCREPANCY"].includes(
    trip.status,
  );
  return (
    <Card
      className="space-y-4 border-l-4 border-l-primary"
      data-testid="driver-trip-card"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-2xl font-bold">
            <T
              k="Trip #{0}"
              values={[<Value key="number" value={trip.trip_number} />]}
            />
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            <T k="Vehicle" /> {trip.plate_number}
          </p>
        </div>
        <span className="rounded-full bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary">
          <Message
            value={
              trip.cancelled
                ? "Cancelled"
                : trip.status === "ACTIVE" && !trip.carryover_pending
                  ? "Trip active"
                  : roundLabel(trip.status)
            }
          />
        </span>
      </div>
      {trip.status === "LOADED" && (
        <>
          <p className="text-sm text-muted-foreground">
            <T
              k="Scheduled for {0}"
              values={[<DateValue key="date" value={scheduled} />]}
            />
          </p>
        </>
      )}
      {primary && ["DRAFT", "LOADED"].includes(trip.status) && (
        <StartTripAction trip={trip} workspace={data.workspace} />
      )}
      {returned && (
        <p className="text-sm">
          <T k="Needs warehouse confirmation. Your next trip can be assigned after this return is confirmed." />
        </p>
      )}
      {trip.carryover_pending &&
        primary &&
        !trip.cancelled &&
        trip.status !== "CLOSED" && (
          <OperationForm
            operation="continue"
            trip={trip.id}
            requestKey={crypto.randomUUID()}
            label="Resume carried trip"
            confirm="Resume the authorized carryover using the stock already in your vehicle?"
          />
        )}
      <Link
        className="inline-flex min-h-11 items-center text-sm font-semibold text-primary underline"
        href={`/driver/trips/${trip.id}`}
      >
        <T k="Trip details" />
      </Link>
    </Card>
  );
}
