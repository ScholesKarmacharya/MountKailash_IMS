import Link from "next/link";
import { getCustomerDeliveries } from "@/services/operations";
import { formatNepalTime } from "@/domain/business-days/time";
import { Card } from "./ui/card";
export async function CustomerReport({ id }: { id: string }) {
  const visits = await getCustomerDeliveries(id);
  const trips = new Map<
    string,
    {
      number: number;
      date: string;
      full: number;
      empty: number;
      cartons: number;
      visits: number;
    }
  >();
  for (const v of visits) {
    const t = trips.get(v.trip_id) ?? {
      number: v.trip_number,
      date: v.date_label,
      full: 0,
      empty: 0,
      cartons: 0,
      visits: 0,
    };
    t.full += v.full_jars;
    t.empty += v.empty_jars;
    t.cartons += v.cartons;
    t.visits++;
    trips.set(v.trip_id, t);
  }
  return (
    <Card>
      <h2 className="mb-4 font-semibold">Customer delivery history</h2>
      {visits.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No delivery visits recorded for this customer.
        </p>
      ) : (
        <>
          <h3 className="text-sm font-semibold">Grouped by trip</h3>
          {Array.from(trips.entries()).map(([trip, t]) => (
            <div key={trip} className="border-b border-border py-4">
              <Link
                className="font-semibold text-primary underline"
                href={`/admin/trips/${trip}`}
              >
                Trip #{t.number} · {t.date}
              </Link>
              <p className="mt-2 text-sm">
                {t.visits} visits · {t.full} full delivered · {t.empty} empty
                collected · {t.cartons} cartons
              </p>
            </div>
          ))}
          <h3 className="mt-5 text-sm font-semibold">Separate visits</h3>
          {visits.map((v) => (
            <p key={v.id} className="py-3 text-sm">
              {formatNepalTime(v.created_at)} · Trip #{v.trip_number} ·{" "}
              {v.full_jars} full / {v.empty_jars} empty / {v.cartons} cartons ·
              NPR {v.value_snapshot}
            </p>
          ))}
        </>
      )}
      <p className="mt-4 text-xs text-muted-foreground">
        Delivery values are price snapshots. Financial settlement, credit and
        deposits remain pending Sprint 3.
      </p>
    </Card>
  );
}
