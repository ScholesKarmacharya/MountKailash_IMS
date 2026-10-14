import { ProductDeliverySummary } from "./product-delivery-summary";
import {
  groupDeliveries,
  type ProductDelivery,
} from "@/domain/operations/product-delivery";
import { T, DateValue, Value } from "@/components/localization";
import Link from "next/link";
import { getCustomerDeliveries } from "@/services/operations";
import { npr, sum } from "@/domain/finance/money";

import { Card } from "./ui/card";
export async function CustomerReport({ id }: { id: string }) {
  const visits = await getCustomerDeliveries(id);
  const trips = new Map<
    string,
    {
      items: ProductDelivery[];
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
      items: [],
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
    t.items.push(...(v.items ?? []));
    trips.set(v.trip_id, t);
  }
  return (
    <Card>
      <h2 className="mb-4 font-semibold">
        <T k="Customer delivery history" />
      </h2>
      {visits.some(
        (v) =>
          v.supply_classification === "FREE_SUPPLY" ||
          v.supply_classification === "MIXED",
      ) && (
        <p className="mb-4 font-semibold">
          <T k="Value of Free Supply" />:{" "}
          <Value value={npr(sum(visits.map((v) => v.free_value ?? "0.00")))} />
        </p>
      )}
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
                <T k="Visits" />: <Value value={t.visits} />
              </p>
              {groupDeliveries(t.items).map((line) => (
                <ProductDeliverySummary
                  key={line.product_id}
                  line={line}
                  aggregate
                />
              ))}
            </div>
          ))}
          <h3 className="mt-5 text-sm font-semibold">
            <T k="Separate visits" />
          </h3>
          {visits.map((v) => (
            <article key={v.id} className="space-y-2 py-3 text-sm">
              <p>
                <DateValue value={v.created_at} time /> ·{" "}
                <T k="Trip #{0}" values={[v.trip_number]} />
              </p>
              {(v.items ?? []).map((line) => (
                <ProductDeliverySummary key={line.product_id} line={line} />
              ))}
              <p>
                <T k="Delivery value" />:{" "}
                <Value value={npr(v.value_snapshot)} />
              </p>
              {(v.supply_classification === "FREE_SUPPLY" ||
                v.supply_classification === "MIXED") && (
                <p>
                  <T k="Free Supply" /> · <T k="Value of Free Supply" />:{" "}
                  <Value value={npr(v.free_value ?? "0.00")} /> ·{" "}
                  {v.driver_name}
                </p>
              )}
            </article>
          ))}
        </>
      )}
      <p className="mt-4 text-xs text-muted-foreground">
        <T k="Delivery values preserve original prices. Payments, credit and deposits are shown in the separate financial ledgers." />
      </p>
    </Card>
  );
}
