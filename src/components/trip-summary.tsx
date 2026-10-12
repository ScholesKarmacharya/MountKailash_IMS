import { getFinance } from "@/services/finance";
import { npr, sum } from "@/domain/finance/money";
import { CollectCreditForm } from "./finance-payment";
import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getOperations } from "@/services/operations";
import {
  type Trip,
  type Workspace,
  vehicleCounts,
} from "@/domain/operations/types";
import { stockLabels } from "@/domain/inventory/validation";
import { formatNepalTime } from "@/domain/business-days/time";
import { Card } from "./ui/card";
import { Button } from "./ui/button";
import {
  MigrationRequired,
  OperationsHeading,
  TripLink,
} from "./operations-layout";
import { OperationForm, Field } from "./operation-form";
import { DeliveryForm, LoadTripForm, ReturnForm } from "./trip-forms";
export function TripList({ trips, admin }: { trips: Trip[]; admin: boolean }) {
  return (
    <div className="space-y-3">
      {trips.length === 0 && (
        <p className="rounded-xl border border-border bg-card p-6 text-muted-foreground">
          No assigned trips.
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
              {t.date_label} · {t.plate_number}
              {admin && ` · ${t.driver_name}`}
            </p>
          </div>
          <span className="rounded-full bg-muted px-3 py-2 text-xs font-semibold">
            {t.status.replaceAll("_", " ")}
          </span>
        </Card>
      ))}
    </div>
  );
}
export function StockCards({
  workspace: w,
  trip,
}: {
  workspace: Workspace;
  trip: Trip;
}) {
  const counts = vehicleCounts(w, trip);
  return (
    <div className="grid grid-cols-3 gap-2">
      {(["FULL_JAR", "EMPTY_JAR", "BOTTLE_CARTON"] as const).map((kind) => (
        <Card key={kind} className="p-3 sm:p-5">
          <p className="text-xs font-semibold text-muted-foreground">
            {stockLabels[kind]}
          </p>
          <p className="mt-3 text-3xl font-bold">
            {counts
              .filter((c) => c.stock_kind === kind)
              .reduce((sum, c) => sum + c.quantity, 0)}
          </p>
        </Card>
      ))}
    </div>
  );
}
export function LoadedStock({
  workspace: w,
  trip,
}: {
  workspace: Workspace;
  trip: Trip;
}) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {(["FULL_JAR", "EMPTY_JAR", "BOTTLE_CARTON"] as const).map((kind) => (
        <Card key={kind} className="p-3 sm:p-5">
          <p className="text-xs font-semibold text-muted-foreground">
            {stockLabels[kind]}
          </p>
          <p className="mt-3 text-3xl font-bold">
            {w.loads
              .filter((l) => l.trip_id === trip.id && l.stock_kind === kind)
              .reduce((s, l) => s + l.quantity, 0)}
          </p>
        </Card>
      ))}
    </div>
  );
}
export async function TripDetail({
  id,
  admin,
}: {
  id: string;
  admin: boolean;
}) {
  const [w, f] = await Promise.all([
    getOperations(admin, id),
    getFinance(admin),
  ]);
  if (!w.available) return <MigrationRequired />;
  const trip = w.trips.find((t) => t.id === id);
  if (!trip) notFound();
  const operational = trip.status !== "CLOSED";
  const dayOpen = w.days.some(
    (d) => d.id === trip.business_day_id && d.status === "OPEN",
  );
  const groups = new Map<
    string,
    {
      name: string;
      visits: number;
      full: number;
      empty: number;
      cartons: number;
    }
  >();
  for (const visit of w.visits) {
    const key = visit.customer_id ?? `walk:${visit.id}`;
    const g = groups.get(key) ?? {
      name:
        w.customers.find((c) => c.id === visit.customer_id)?.name ??
        visit.walk_in_name,
      visits: 0,
      full: 0,
      empty: 0,
      cartons: 0,
    };
    g.visits++;
    for (const item of w.items.filter((i) => i.visit_id === visit.id)) {
      g.full += item.full_jars;
      g.empty += item.empty_jars;
      g.cartons += item.cartons;
    }
    groups.set(key, g);
  }
  return (
    <div className="space-y-6">
      <Link
        className="text-primary underline"
        href={admin ? "/admin/trips" : "/driver/home"}
      >
        Back to {admin ? "trips" : "my day"}
      </Link>
      <OperationsHeading
        title={`Trip #${trip.trip_number}`}
        description={`${trip.plate_number} · ${trip.driver_name} · Business day ${trip.date_label}`}
      />
      <p className="inline-block rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white">
        {trip.status.replaceAll("_", " ")}
      </p>
      {trip.notes && <p className="text-sm">{trip.notes}</p>}
      {w.loads.length > 0 && (
        <>
          <h2 className="font-semibold">Loaded Stock</h2>
          <LoadedStock workspace={w} trip={trip} />
        </>
      )}
      {operational && w.loads.length > 0 && (
        <>
          <h2 className="font-semibold">Remaining vehicle stock</h2>
          <StockCards workspace={w} trip={trip} />
        </>
      )}
      {!dayOpen && operational && (
        <p role="alert" className="rounded-lg bg-amber-50 p-4 text-sm">
          The assigned business day is no longer OPEN. Operations are locked for
          admin review.
        </p>
      )}
      {f.available && (
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            [
              "Invoice sales",
              sum(
                f.invoices
                  .filter((i) =>
                    f.sales.some(
                      (s) => s.trip_id === trip.id && s.id === i.sale_id,
                    ),
                  )
                  .map((i) => i.total),
              ),
            ],
            [
              "Confirmed collections",
              sum(
                f.payments
                  .filter(
                    (p) => p.trip_id === trip.id && p.status === "CONFIRMED",
                  )
                  .map((p) => p.amount),
              ),
            ],
            [
              "Credit issued",
              sum(
                f.issued
                  .filter((c) =>
                    f.invoices.some(
                      (i) =>
                        i.id === c.invoice_id &&
                        f.sales.some(
                          (s) => s.id === i.sale_id && s.trip_id === trip.id,
                        ),
                    ),
                  )
                  .map((c) => c.amount),
              ),
            ],
          ].map(([label, value]) => (
            <Card key={label}>
              <h2 className="text-sm text-muted-foreground">{label}</h2>
              <p className="mt-3 font-bold">{npr(value!)}</p>
            </Card>
          ))}
        </div>
      )}
      {f.available && f.payments.some((p) => p.trip_id === trip.id) && (
        <Card>
          <h2 className="mb-4 font-semibold">Trip receipts</h2>
          {f.payments
            .filter((p) => p.trip_id === trip.id)
            .map((p) => (
              <p key={p.id} className="py-2">
                <Link
                  className="text-primary underline"
                  href={(admin ? "/admin" : "/driver") + "/payments/" + p.id}
                >
                  Receipt R-{p.number.padStart(8, "0")}
                </Link>{" "}
                - {p.method} - {p.status} - NPR {p.amount}
              </p>
            ))}
        </Card>
      )}
      {dayOpen && admin && trip.status === "DRAFT" && (
        <Card>
          <h2 className="mb-5 text-lg font-semibold">Load vehicle</h2>
          <LoadTripForm workspace={w} trip={trip} requestKey={randomUUID()} />
        </Card>
      )}
      {dayOpen && trip.status === "LOADED" && (
        <Card>
          <OperationForm
            operation="start"
            trip={id}
            requestKey={randomUUID()}
            label="Start trip"
            confirm="Start this loaded trip?"
          />
        </Card>
      )}
      {dayOpen && trip.status === "ACTIVE" && (
        <>
          <Card id="add-delivery">
            <h2 className="mb-5 text-xl font-bold">New Delivery</h2>
            <DeliveryForm
              finance={f}
              workspace={w}
              trip={trip}
              requestKey={randomUUID()}
            />
            {f.available && (
              <div className="mt-8 border-t pt-6">
                <h3 className="mb-4 font-semibold">
                  Collect credit without a new sale
                </h3>
                <CollectCreditForm
                  finance={f}
                  workspace={w}
                  trip={trip}
                  requestKey={randomUUID()}
                />
              </div>
            )}
          </Card>
          <Card id="submit-trip">
            <h2 className="mb-5 text-lg font-semibold">End trip</h2>
            <ReturnForm
              workspace={w}
              trip={trip}
              requestKey={randomUUID()}
              admin={false}
            />
          </Card>
        </>
      )}
      {dayOpen &&
        admin &&
        ["SUBMITTED", "UNDER_REVIEW", "DISCREPANCY"].includes(trip.status) && (
          <Card>
            <h2 className="mb-5 text-xl font-bold">Verify physical returns</h2>
            {trip.status !== "UNDER_REVIEW" && (
              <div className="mb-7">
                <OperationForm
                  operation="review"
                  trip={id}
                  requestKey={randomUUID()}
                  label="Mark under review"
                >
                  <Field
                    name="reason"
                    label="Review reason"
                    required
                    maxLength={500}
                  />
                </OperationForm>
              </div>
            )}
            <ReturnForm
              workspace={w}
              trip={trip}
              requestKey={randomUUID()}
              admin
            />
          </Card>
        )}
      {!admin &&
        ["SUBMITTED", "UNDER_REVIEW", "DISCREPANCY"].includes(trip.status) && (
          <Card>
            <p className="font-semibold">Awaiting warehouse verification</p>
            <p className="mt-3 text-sm text-muted-foreground">
              Your declared returns are saved. Admin will check physical stock
              and resolve any discrepancies.
            </p>
          </Card>
        )}
      {trip.status === "CLOSED" && (
        <Card>
          <h2 className="font-semibold">Physical trip closed</h2>
          <p className="mt-3 text-sm">{trip.close_reason}</p>
          <p className="mt-3 text-sm text-muted-foreground">
            Physical reconciliation remains independent of financial settlement.
            Historical visits and return checks are preserved.
          </p>
        </Card>
      )}
      <Card>
        <h2 className="mb-5 text-lg font-semibold">Customer totals</h2>
        {groups.size === 0 ? (
          <p className="text-sm text-muted-foreground">
            No delivery visits recorded.
          </p>
        ) : (
          Array.from(groups.entries()).map(([key, g]) => (
            <div
              className="border-b border-border py-3 last:border-0"
              key={key}
            >
              <p className="font-semibold">
                {g.name} · {g.visits} visit{g.visits === 1 ? "" : "s"}
              </p>
              <p className="mt-2 text-sm">
                {g.full} full delivered · {g.empty} empty collected ·{" "}
                {g.cartons} cartons delivered
              </p>
            </div>
          ))
        )}
      </Card>
      <Card>
        <h2 className="mb-5 text-lg font-semibold">Separate visit history</h2>
        {w.visits.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Every saved visit will appear here.
          </p>
        )}
        {w.visits.map((v) => {
          const payment = w.payments.find((p) => p.visit_id === v.id);
          return (
            <article
              key={v.id}
              className="space-y-2 border-b border-border py-4 last:border-0"
            >
              <p className="font-semibold">
                {w.customers.find((c) => c.id === v.customer_id)?.name ??
                  v.walk_in_name}
              </p>
              <p className="text-xs text-muted-foreground">
                {formatNepalTime(v.created_at)} · {v.id}
              </p>
              {w.items
                .filter((i) => i.visit_id === v.id)
                .map((i) => (
                  <p className="text-sm" key={i.product_id}>
                    {w.products.find((p) => p.id === i.product_id)?.name}:{" "}
                    {i.full_jars} full · {i.empty_jars} empty · {i.cartons}{" "}
                    cartons · Unit price NPR {i.unit_price_snapshot}
                  </p>
                ))}
              <p className="text-sm">
                Delivery value NPR {v.value_snapshot} · {payment?.selection} ·
                Reported {payment?.reported_amount ?? "not specified"}
              </p>
              <p className="text-xs text-amber-800">
                {f.available
                  ? f.sales.some((s) => s.visit_id === v.id)
                    ? "Invoice recorded; Fonepay requires reconciliation"
                    : w.items
                          .filter((i) => i.visit_id === v.id)
                          .every((i) => i.full_jars + i.cartons === 0)
                      ? "Empty-return visit; no new sale or invoice"
                      : "Legacy visit: finance has not been posted"
                  : "Finance migration required; legacy payment intent"}
              </p>
              {f.invoices
                .filter((i) =>
                  f.sales.some(
                    (s) => s.id === i.sale_id && s.visit_id === v.id,
                  ),
                )
                .map((i) => (
                  <Link
                    key={i.id}
                    className="text-primary underline"
                    href={(admin ? "/admin" : "/driver") + "/invoices/" + i.id}
                  >
                    Invoice MK-{i.number.padStart(8, "0")} - outstanding NPR{" "}
                    {i.outstanding}
                  </Link>
                ))}
              {payment?.reference && (
                <p className="text-xs">Reference: {payment.reference}</p>
              )}
              {v.notes && <p className="text-sm">{v.notes}</p>}
            </article>
          );
        })}
      </Card>
      {w.declarations.length > 0 && (
        <Card>
          <h2 className="mb-3 font-semibold">Driver return declaration</h2>
          {w.declarations.map((c) => (
            <p key={`${c.product_id}:${c.stock_kind}`} className="py-2 text-sm">
              {w.products.find((p) => p.id === c.product_id)?.name} ·{" "}
              {stockLabels[c.stock_kind]}: {c.quantity}
            </p>
          ))}
        </Card>
      )}
      {w.checks.map((check) => (
        <Card key={check.id}>
          <h2 className="font-semibold">
            {check.outcome} · {formatNepalTime(check.created_at)}
          </h2>
          <p className="my-3 text-sm">{check.reason}</p>
          {w.check_items
            .filter((i) => i.check_id === check.id)
            .map((i) => (
              <p
                className="py-2 text-sm"
                key={`${i.product_id}:${i.stock_kind}`}
              >
                {w.products.find((p) => p.id === i.product_id)?.name} ·{" "}
                {stockLabels[i.stock_kind]}: expected {i.expected}, declared{" "}
                {i.declared}, verified {i.actual}
              </p>
            ))}
          {w.discrepancies
            .filter((d) => d.check_id === check.id)
            .map((d) => (
              <p
                className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900"
                key={d.id}
              >
                Variance {d.actual - d.expected} ·{" "}
                {d.approved_by ? "Approved" : "Pending resolution"} ·{" "}
                {d.resolution}
              </p>
            ))}
        </Card>
      ))}
      <Card>
        <h2 className="mb-4 font-semibold">Immutable inventory journal</h2>
        {w.movements.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No posted stock movements.
          </p>
        )}
        {w.movements.map((m) => (
          <div
            key={m.id}
            className="border-b border-border py-3 text-sm last:border-0"
          >
            <p>
              {m.movement_type.replaceAll("_", " ")} ·{" "}
              {w.products.find((p) => p.id === m.product_id)?.name} ·{" "}
              {stockLabels[m.stock_kind]} · {m.quantity}
            </p>
            <p className="mt-1 break-words text-xs text-muted-foreground">
              {formatNepalTime(m.created_at)} · Actor {m.actor_user_id} · Day{" "}
              {trip.date_label}
              {m.visit_id && ` · Visit ${m.visit_id}`}
            </p>
          </div>
        ))}
      </Card>
      {dayOpen && admin && trip.status === "DRAFT" && (
        <Card>
          <h2 className="mb-4 font-semibold">Cancel draft</h2>
          <OperationForm
            operation="cancel"
            trip={id}
            requestKey={randomUUID()}
            label="Cancel unladen draft"
          >
            <Field
              name="reason"
              label="Cancellation reason"
              required
              maxLength={500}
            />
          </OperationForm>
        </Card>
      )}
      {!admin && trip.status === "ACTIVE" && (
        <div className="sticky bottom-3 grid grid-cols-2 gap-2 rounded-xl border border-border bg-card p-2 shadow-lg">
          <Button asChild className="min-h-14">
            <a href="#add-delivery">New Delivery</a>
          </Button>
          <Button asChild variant="outline" className="min-h-14">
            <a href="#submit-trip">End trip</a>
          </Button>
        </div>
      )}
    </div>
  );
}
