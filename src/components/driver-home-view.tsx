"use client";
import { T, Message, DateValue } from "@/components/localization";
import Link from "next/link";

import type { DriverData } from "./driver-application";
import { roundLabel, tripCanStart } from "@/domain/operations/driver-workspace";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  MigrationRequired,
  OperationsHeading,
} from "@/components/operations-layout";
import { TripList } from "./trip-list";
import { OperationForm } from "@/components/operation-form";
import { DriverStock, DriverMoney } from "@/components/driver-stock";
import { OperationalRefresh } from "@/components/operational-refresh";

export function DriverHomeView({ data }: { data: DriverData }) {
  const {
    overview,
    workspace: w,
    finance,
    trip,
    day,
    dayOpen,
    delivering,
  } = data;
  const loaded =
    !!trip && w.loads.some((l) => l.trip_id === trip.id && l.quantity > 0);
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <OperationsHeading
        title="My day"
        description="Your stock, customers and sales. One delivery round at a time."
      />
      <OperationalRefresh />
      <Button asChild className="min-h-14 w-full sm:w-auto">
        <Link href="/driver/instant-delivery">
          <T k="Instant Delivery" />
        </Link>
      </Button>
      {!w.available ? (
        <MigrationRequired />
      ) : (
        <>
          {!loaded && (
            <Card>
              <h2 className="font-semibold">
                <T k="No active delivery stock. Waiting for warehouse loading." />
              </h2>
              <p className="mt-3 text-sm text-muted-foreground">
                <T k="Confirmed loads appear here automatically. You can look up customers and view your previous rounds while waiting." />
              </p>
            </Card>
          )}
          {trip && (
            <Card className="space-y-4 border-l-4 border-l-primary">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="font-semibold">
                  <T k="My Active Trip" />
                </h2>
                <span className="rounded-full bg-muted px-3 py-2 text-xs font-semibold">
                  <Message value={roundLabel(trip.status)} />
                </span>
              </div>
              <p className="text-xl font-bold">
                <T k="Assigned Vehicle: {0}" values={[trip.plate_number]} />
              </p>
              <p className="text-sm text-muted-foreground">
                <T
                  k="Round #{0} · scheduled delivery {1}"
                  values={[
                    trip.trip_number,
                    <DateValue key="v1" value={trip.date_label} />,
                  ]}
                />
              </p>
              {!dayOpen && (
                <p role="alert">
                  <T k="This business day is under review or closed. Delivery posting is locked." />
                </p>
              )}
              {trip.status === "LOADED" && !tripCanStart(w, trip) && (
                <p role="status">
                  <T k="Prepared stock stays in your vehicle. Start on or after the scheduled date, then synchronize your device before working offline." />
                </p>
              )}
              {trip.carryover_pending && (
                <OperationForm
                  operation="continue"
                  trip={trip.id}
                  requestKey={crypto.randomUUID()}
                  label="Resume carried trip"
                  confirm="Resume the authorized carryover using the stock already in your vehicle?"
                />
              )}
              {tripCanStart(w, trip) && (
                <OperationForm
                  operation="start"
                  trip={trip.id}
                  requestKey={crypto.randomUUID()}
                  label="Start delivering"
                  confirm="Start delivering this confirmed warehouse load?"
                />
              )}
              {["SUBMITTED", "UNDER_REVIEW", "DISCREPANCY"].includes(
                trip.status,
              ) && (
                <p>
                  <T k="Your return declaration is saved. Warehouse stock changes after admin physical verification." />
                </p>
              )}
              <Link
                className="inline-block py-2 text-sm font-semibold text-primary underline"
                href={"/driver/trips/" + trip.id}
              >
                <T k="View round and return history" />
              </Link>
            </Card>
          )}
          {trip && loaded && <DriverStock workspace={w} trip={trip} />}
          {trip && delivering && data.round?.phase === "ACTIVE" && (
            <Card>
              <p className="mb-4 text-sm">
                <T k="Pause and synchronize all records before requesting overnight carryover. Vehicle stock remains assigned." />
              </p>
              <OperationForm
                operation="pause"
                trip={trip.id}
                requestKey={crypto.randomUUID()}
                label="Pause for overnight carryover"
                confirm="Pause deliveries and synchronize this device checkpoint before admin carryover review?"
              />
            </Card>
          )}
          {delivering && (
            <Button asChild className="min-h-16 w-full text-lg">
              <Link href="/driver/delivery">
                <T k="New Delivery" />
              </Link>
            </Button>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Button asChild variant="outline" className="min-h-14">
              <Link href="/driver/customers">
                <T k="Add / Find Customer" />
              </Link>
            </Button>
            <Button asChild variant="outline" className="min-h-14">
              <Link href="/driver/pending-jars">
                <T k="Pending Jars" />
              </Link>
            </Button>
            <Button asChild variant="outline" className="min-h-14">
              <Link href="/driver/sales">
                <T k="Sales History" />
              </Link>
            </Button>
            <Button asChild variant="outline" className="min-h-14">
              <Link href="/driver/return">
                <T k="Return to Warehouse" />
              </Link>
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            {day ? (
              <T
                k="Today's totals belong to business day {0}, across your rounds. The day can extend past midnight."
                values={[<DateValue key="day" value={day.date_label} />]}
              />
            ) : (
              <T k="No assigned open business day. New daily counters begin with the next assigned day." />
            )}
          </p>
          <DriverMoney finance={finance} day={day?.id ?? "no-open-day"} />
          {trip && loaded && <DriverMoney finance={finance} trip={trip.id} />}
          <section>
            <h2 className="mb-4 font-semibold">
              <T k="Recent trips" />
            </h2>
            <TripList
              trips={overview.trips.filter((t) => t.status === "CLOSED")}
              admin={false}
            />
          </section>
        </>
      )}
    </div>
  );
}
