import type { Trip } from "@/domain/operations/types";
import { T, Message, DateValue } from "./localization";
import { Card } from "./ui/card";
import { TripLink } from "./operations-layout";
import { roundLabel } from "@/domain/operations/driver-workspace";
export function TripList({ trips, admin }: { trips: Trip[]; admin: boolean }) {
  return (
    <div className="space-y-3">
      {trips.length === 0 && (
        <p className="rounded-xl border border-border bg-card p-6 text-muted-foreground">
          <T k="No assigned trips." />
        </p>
      )}
      {trips.map((t) => (
        <Card
          key={t.id}
          className="flex flex-wrap items-center justify-between gap-4 p-5"
        >
          <div>
            <TripLink
              id={t.id}
              number={t.trip_number}
              base={admin ? "/admin/trips" : "/driver/trips"}
            />
            <p className="mt-2 text-sm text-muted-foreground">
              <DateValue value={t.date_label} /> · {t.plate_number}
              {admin && ` · ${t.driver_name}`}
            </p>
          </div>
          <span className="rounded-full bg-muted px-3 py-2 text-xs font-semibold">
            <Message
              value={
                t.cancelled
                  ? "Cancelled"
                  : admin
                    ? t.status.replaceAll("_", " ")
                    : roundLabel(t.status)
              }
            />
          </span>
        </Card>
      ))}
    </div>
  );
}
