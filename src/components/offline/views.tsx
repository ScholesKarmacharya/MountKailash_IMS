"use client";
import type { LocalState, DeliveryDraft } from "@/domain/offline/types";
import {
  customerEstimate,
  localCustomers,
  localStock,
} from "@/domain/offline/operations";
import { Card } from "../ui/card";
import { T, Message, DateValue } from "../localization";
import { ProductDeliverySummary } from "../product-delivery-summary";
import { productDeliveries } from "@/domain/operations/product-delivery";

export function OfflineDeliveryFields({
  state,
  items,
  customer,
}: {
  state: LocalState;
  items: DeliveryDraft["items"];
  customer: string | null;
}) {
  return (
    <div className="space-y-3">
      {productDeliveries(items, state.snapshot.workspace.products).map(
        (line) => (
          <ProductDeliverySummary key={line.product_id} line={line} />
        ),
      )}
      {customer &&
        items
          .filter(
            (i) =>
              state.snapshot.workspace.products.find(
                (p) => p.id === i.product_id,
              )?.kind === "FULL_JAR",
          )
          .map((i) => (
            <p key={i.product_id}>
              <T k="Estimated unreturned jars" />:{" "}
              {customerEstimate(state, customer, i.product_id).estimated +
                i.full_jars -
                i.empty_jars}
            </p>
          ))}
    </div>
  );
}
export function OfflineStock({ state }: { state: LocalState }) {
  const included = new Set(
    state.snapshot.receipts
      .filter((r) => r.status === "CONFIRMED")
      .map((r) => r.id),
  );
  const pending = state.operations
    .filter(
      (o) => ["DELIVERY", "INSTANT"].includes(o.kind) && !included.has(o.id),
    )
    .map((o) => JSON.parse(o.payload) as DeliveryDraft);
  const totals = (key: "full_jars" | "empty_jars" | "cartons") =>
    state.snapshot.workspace.items.reduce((n, i) => n + i[key], 0) +
    pending.reduce((n, o) => n + o.items.reduce((q, i) => q + i[key], 0), 0);
  const stock = localStock(state),
    sum = (kind: string) =>
      stock
        .filter((c) => c.stock_kind === kind)
        .reduce((n, c) => n + c.quantity, 0);
  const metrics: [string, number][] = [
    [
      "Loaded Jars",
      state.snapshot.workspace.loads
        .filter((l) => l.stock_kind === "FULL_JAR")
        .reduce((n, l) => n + l.quantity, 0),
    ],
    ["Jars Sold", totals("full_jars")],
    ["Remaining Jars", sum("FULL_JAR")],
    ["Empty Jars Returned", totals("empty_jars")],
    [
      "Loaded Cartons",
      state.snapshot.workspace.loads
        .filter((l) => l.stock_kind === "BOTTLE_CARTON")
        .reduce((n, l) => n + l.quantity, 0),
    ],
    ["Cartons Sold", totals("cartons")],
    ["Remaining Cartons", sum("BOTTLE_CARTON")],
  ];
  return (
    <>
      <h1 className="text-2xl font-bold">
        <T k="My Stock" />
      </h1>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {metrics.map(([label, n]) => (
          <Card key={label}>
            <p className="text-sm">
              <Message value={label} />
            </p>
            <p
              className="mt-2 text-3xl font-bold"
              data-testid={`offline-${label.toLowerCase().replaceAll(" ", "-")}`}
            >
              {n}
            </p>
          </Card>
        ))}
      </div>
      <p className="text-sm">
        <T k="Confirmed stock plus device records. Pending and disputed sales are included until resolved." />
      </p>
    </>
  );
}
export function OfflineHistory({
  state,
  pendingOnly = false,
}: {
  state: LocalState;
  pendingOnly?: boolean;
}) {
  const customers = localCustomers(state),
    localResults = new Set(
      state.operations
        .filter(
          (o) => ["DELIVERY", "INSTANT"].includes(o.kind) && o.acknowledgement,
        )
        .map((o) =>
          o.kind === "INSTANT"
            ? state.snapshot.instant?.records.find(
                (r) => r.id === o.acknowledgement?.result,
              )?.visit_id
            : o.acknowledgement?.result,
        ),
    );
  return (
    <>
      {pendingOnly ? (
        <h2 className="text-xl font-bold">
          <T k="Unconfirmed transactions" />
        </h2>
      ) : (
        <h1 className="text-2xl font-bold">
          <T k="Sales History" />
        </h1>
      )}
      {state.operations
        .filter(
          (o) =>
            ["DELIVERY", "INSTANT"].includes(o.kind) &&
            (!pendingOnly || o.status !== "SYNCED"),
        )
        .map((o) => {
          const d = JSON.parse(o.payload) as DeliveryDraft;
          return (
            <Card key={o.id} className="space-y-3">
              <h2 className="font-bold">
                {customers.find((c) => c.id === d.customer)?.name ??
                  d.walk_name}
              </h2>
              <p>
                <DateValue value={o.occurredAt} time /> ·{" "}
                <Message
                  value={
                    o.status === "SYNCED"
                      ? "Server-confirmed"
                      : o.status === "NEEDS_REVIEW"
                        ? "Needs Review"
                        : "Saved on Device"
                  }
                />
              </p>
              <OfflineDeliveryFields
                state={state}
                items={d.items}
                customer={null}
              />
              <p>
                <T k="Payment Status" />:{" "}
                <Message
                  value={
                    d.status === "FREE_SUPPLY"
                      ? "Free Supply"
                      : d.status === "PAID"
                        ? "Paid"
                        : d.status === "CREDIT"
                          ? "Credit"
                          : "Empty return only"
                  }
                />{" "}
                · <T k="Total Amount" />: <T k="NPR" /> {d.total}
              </p>
              {o.message && (
                <p role="alert">
                  <Message value={o.message} />
                </p>
              )}
              {o.acknowledgement?.result && (
                <a
                  className="text-primary underline"
                  href={`/driver/trips/${o.trip}`}
                >
                  <T k="View server-confirmed round and invoices" />
                </a>
              )}
              <p className="break-all text-xs text-muted-foreground">{o.id}</p>
            </Card>
          );
        })}
      {state.snapshot.workspace.visits
        .filter((v) => !pendingOnly && !localResults.has(v.id))
        .map((v) => (
          <Card key={v.id} className="space-y-3">
            <p className="font-semibold">
              {customers.find((c) => c.id === v.customer_id)?.name ??
                v.walk_in_name}
            </p>
            <p>
              <DateValue value={v.created_at} time /> ·{" "}
              <T k="Server-confirmed" />
            </p>
            {productDeliveries(
              state.snapshot.workspace.items.filter((i) => i.visit_id === v.id),
              state.snapshot.workspace.products,
            ).map((line) => (
              <ProductDeliverySummary key={line.product_id} line={line} />
            ))}
            <p>
              <T k="NPR" /> {v.value_snapshot}
            </p>
          </Card>
        ))}
      {!pendingOnly &&
        !state.operations.some((o) =>
          ["DELIVERY", "INSTANT"].includes(o.kind),
        ) &&
        !state.snapshot.workspace.visits.length && (
          <Card>
            <T k="No sales recorded for this round." />
          </Card>
        )}
    </>
  );
}
