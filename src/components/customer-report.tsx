import { T, DateValue, Value } from "@/components/localization";
import Link from "next/link";
import { getCustomerDeliveries } from "@/services/operations";

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
      <h2 className="mb-4 font-semibold">
        <T k="Customer delivery history" />
      </h2>
      {visits.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          <T k="No delivery visits recorded for this customer." />
        </p>
      ) : (
        <>
          <h3 className="text-sm font-semibold">
            <T k="Grouped by trip" />
          </h3>
          {Array.from(trips.entries()).map(([trip, t]) => (
            <div key={trip} className="border-b border-border py-4">
              <Link
                className="font-semibold text-primary underline"
                href={`/admin/trips/${trip}`}
              >
                <T
                  k="Trip #{0} · {1}"
                  values={[t.number, <DateValue key="date" value={t.date} />]}
                />
              </Link>
              <p className="mt-2 text-sm">
                <T
                  k="{0} visits · {1} full delivered · {2} empty collected · {3} cartons"
                  values={[
                    <Value key="v0" value={t.visits} />,
                    t.full,
                    t.empty,
                    <Value key="v3" value={t.cartons} />,
                  ]}
                />
              </p>
            </div>
          ))}
          <h3 className="mt-5 text-sm font-semibold">
            <T k="Separate visits" />
          </h3>
          {visits.map((v) => (
            <p key={v.id} className="py-3 text-sm">
              <T
                k="{0} · Trip #{1} · {2} full / {3} empty / {4} cartons · NPR {5}"
                values={[
                  <DateValue key="v0" value={v.created_at} time />,
                  v.trip_number,
                  <Value key="v2" value={v.full_jars} />,
                  <Value key="v3" value={v.empty_jars} />,
                  <Value key="v4" value={v.cartons} />,
                  v.value_snapshot,
                ]}
              />
            </p>
          ))}
        </>
      )}
      <p className="mt-4 text-xs text-muted-foreground">
        <T k="Delivery values preserve original prices. Payments, credit and deposits are shown in the separate financial ledgers." />
      </p>
    </Card>
  );
}
