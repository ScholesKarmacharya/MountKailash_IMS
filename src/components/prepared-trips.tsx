import Link from "next/link";
import type { DayReport } from "@/domain/business-days/types";
import { Card } from "./ui/card";
import { T, DateValue, Value } from "./localization";
import { MetricGrid } from "./report-ui";
export function PreparedTrips({ report }: { report: DayReport }) {
  const trips = report.prepared_trips ?? [];
  const warehouse = report.stock
    .filter(
      (s) => s.location_kind === "WAREHOUSE" && s.stock_kind === "FULL_JAR",
    )
    .reduce((n, s) => n + s.closing, 0);
  return (
    <>
      <Card className="space-y-4">
        <h2 className="text-xl font-semibold">
          <T k="Prepared for tomorrow and later" />
        </h2>
        <p role="status">
          <T
            k="{0} trips are prepared for a future date. They remain prepared after this business day is closed."
            values={[trips.length]}
          />
        </p>
        {trips.map((t) => (
          <div key={t.id} className="rounded-lg border p-3 text-sm">
            <Link
              href={`/admin/trips/${t.id}`}
              className="font-semibold text-primary underline"
            >
              {t.plate_number} · {t.driver_name}
            </Link>
            <p>
              <DateValue value={t.scheduled_date} /> · <T k="Full jars" />:{" "}
              <Value value={t.full_jars} /> · <T k="Cartons" />:{" "}
              <Value value={t.cartons} />
            </p>
            <p className="mt-2 text-muted-foreground">
              <T k="Driver must start and synchronize the confirmed allocation before working offline." />
            </p>
          </div>
        ))}
        <MetricGrid
          compact
          items={[
            {
              label: "Total prepared jars",
              value: trips.reduce((n, t) => n + t.full_jars, 0),
            },
            {
              label: "Total prepared cartons",
              value: trips.reduce((n, t) => n + t.cartons, 0),
            },
            { label: "Warehouse available full jars", value: warehouse },
            {
              label: "Warehouse available cartons",
              value: report.stock
                .filter(
                  (s) =>
                    s.location_kind === "WAREHOUSE" &&
                    s.stock_kind === "BOTTLE_CARTON",
                )
                .reduce((n, s) => n + s.closing, 0),
            },
          ]}
        />
      </Card>
      {!!report.carryovers?.length && (
        <Card className="space-y-3">
          <h2 className="text-xl font-semibold">
            <T k="Authorized carryover / pending settlement" />
          </h2>
          {report.carryovers.map((c) => (
            <p key={c.id}>
              <Link
                href={`/admin/trips/${c.trip_id}`}
                className="text-primary underline"
              >
                #{c.trip_number} · {c.plate_number} · {c.driver_name}
              </Link>{" "}
              — {c.reason}
            </p>
          ))}
        </Card>
      )}
    </>
  );
}
