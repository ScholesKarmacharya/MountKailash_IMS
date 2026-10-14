import Link from "next/link";
import {
  Truck,
  UserRound,
  CalendarDays,
  Droplets,
  Package,
} from "lucide-react";
import type { Trip, Workspace } from "@/domain/operations/types";
import { tripLabel, tripTone } from "@/domain/operations/trip-presentation";
import { Card } from "./ui/card";
import { Button } from "./ui/button";
import { StatusBadge } from "./ui/status-badge";
import { T, DateValue, Value } from "./localization";
export function AdminTripCards({
  trips,
  loads,
}: {
  trips: Trip[];
  loads: Workspace["loads"];
}) {
  if (!trips.length)
    return (
      <Card className="text-sm text-muted-foreground">
        <T k="No trips in this list." />
      </Card>
    );
  return (
    <div className="grid gap-3 xl:grid-cols-2">
      {trips.map((trip) => {
        const loaded = (kind: string) =>
          loads
            .filter((l) => l.trip_id === trip.id && l.stock_kind === kind)
            .reduce((n, l) => n + l.quantity, 0);
        return (
          <Card
            key={trip.id}
            data-testid={`trip-card-${trip.id}`}
            className="min-w-0 space-y-4 p-4 sm:p-5"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-semibold">
                <T k="Trip #{0}" values={[trip.trip_number]} />
              </h3>
              <StatusBadge label={tripLabel(trip)} tone={tripTone(trip)} />
            </div>
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="flex items-center gap-2 text-muted-foreground">
                  <UserRound className="size-4" aria-hidden />
                  <T k="Driver" />
                </dt>
                <dd className="mt-1 break-words font-medium">
                  {trip.driver_name}
                </dd>
              </div>
              <div>
                <dt className="flex items-center gap-2 text-muted-foreground">
                  <Truck className="size-4" aria-hidden />
                  <T k="Vehicle" />
                </dt>
                <dd className="mt-1 break-words font-medium">
                  {trip.plate_number}
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="flex items-center gap-2 text-muted-foreground">
                  <CalendarDays className="size-4" aria-hidden />
                  <T k="Scheduled delivery date" />
                </dt>
                <dd className="mt-1 font-medium">
                  <DateValue value={trip.scheduled_date ?? trip.date_label} />
                </dd>
              </div>
            </dl>
            <dl className="grid grid-cols-2 gap-3 rounded-lg bg-muted/60 p-3 text-sm">
              <div>
                <dt className="flex items-center gap-1.5 text-muted-foreground">
                  <Droplets className="size-4 shrink-0" aria-hidden />
                  <T k="Full jars loaded" />
                </dt>
                <dd className="mt-1 text-lg font-semibold">
                  <Value value={loaded("FULL_JAR")} />
                </dd>
              </div>
              <div>
                <dt className="flex items-center gap-1.5 text-muted-foreground">
                  <Package className="size-4 shrink-0" aria-hidden />
                  <T k="Cartons loaded" />
                </dt>
                <dd className="mt-1 text-lg font-semibold">
                  <Value value={loaded("BOTTLE_CARTON")} />
                </dd>
              </div>
            </dl>
            <Button asChild variant="outline" className="w-full sm:w-auto">
              <Link href={`/admin/trips/${trip.id}`}>
                <T k="View trip details" />
              </Link>
            </Button>
          </Card>
        );
      })}
    </div>
  );
}
