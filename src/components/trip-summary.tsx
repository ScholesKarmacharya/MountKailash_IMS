import { T, Message, DateValue, Value } from "@/components/localization";
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

import { Card } from "./ui/card";
import { roundLabel } from "@/domain/operations/driver-workspace";
import { DriverStock } from "./driver-stock";
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
                admin ? t.status.replaceAll("_", " ") : roundLabel(t.status)
              }
            />
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
            <Message value={stockLabels[kind]} />
          </p>
          <p className="mt-3 text-3xl font-bold">
            <Value
              value={counts
                .filter((c) => c.stock_kind === kind)
                .reduce((sum, c) => sum + c.quantity, 0)}
            />
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
            <Message value={stockLabels[kind]} />
          </p>
          <p className="mt-3 text-3xl font-bold">
            <Value
              value={w.loads
                .filter((l) => l.trip_id === trip.id && l.stock_kind === kind)
                .reduce((s, l) => s + l.quantity, 0)}
            />
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
        <T
          k="Back to {0}"
          values={[<Message key="v0" value={admin ? "trips" : "my day"} />]}
        />
      </Link>
      <OperationsHeading
        title={`Trip #${trip.trip_number}`}
        description={
          <T
            k="{0} · {1} · Business day {2}"
            values={[
              trip.plate_number,
              trip.driver_name,
              <DateValue key="date" value={trip.date_label} />,
            ]}
          />
        }
      />
      <p className="inline-block rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white">
        <Message
          value={
            admin ? trip.status.replaceAll("_", " ") : roundLabel(trip.status)
          }
        />
      </p>
      {trip.notes && <p className="text-sm">{trip.notes}</p>}
      {w.loads.length > 0 && <DriverStock workspace={w} trip={trip} />}
      {w.loads.length > 0 && (
        <>
          <h2 className="font-semibold">
            <T k="Loaded Stock" />
          </h2>
          <LoadedStock workspace={w} trip={trip} />
        </>
      )}
      {operational && w.loads.length > 0 && (
        <>
          <h2 className="font-semibold">
            <T k="Remaining vehicle stock" />
          </h2>
          <StockCards workspace={w} trip={trip} />
        </>
      )}
      {!dayOpen && operational && (
        <p role="alert" className="rounded-lg bg-amber-50 p-4 text-sm">
          <T k="The assigned business day is no longer OPEN. Operations are locked for admin review." />
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
              <h2 className="text-sm text-muted-foreground">
                <Message value={label} />
              </h2>
              <p className="mt-3 font-bold">
                <Value value={npr(value!)} />
              </p>
            </Card>
          ))}
        </div>
      )}
      {f.available && f.payments.some((p) => p.trip_id === trip.id) && (
        <Card>
          <h2 className="mb-4 font-semibold">
            <T k="Trip receipts" />
          </h2>
          {f.payments
            .filter((p) => p.trip_id === trip.id)
            .map((p) => (
              <p key={p.id} className="py-2">
                <Link
                  className="text-primary underline"
                  href={(admin ? "/admin" : "/driver") + "/payments/" + p.id}
                >
                  <T k="Receipt R-{0}" values={[p.number.padStart(8, "0")]} />
                </Link>{" "}
                - <Message value={p.method} /> - <Message value={p.status} />{" "}
                <T k="- NPR" /> <Value value={p.amount} />
              </p>
            ))}
        </Card>
      )}
      {dayOpen && admin && trip.status === "DRAFT" && (
        <Card>
          <h2 className="mb-5 text-lg font-semibold">
            <T k="Load vehicle" />
          </h2>
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
            <h2 className="mb-5 text-xl font-bold">
              <T k="New Delivery" />
            </h2>
            <DeliveryForm
              simplifiedPayment={!admin}
              finance={f}
              workspace={w}
              trip={trip}
              requestKey={randomUUID()}
            />
            {f.available && (
              <div className="mt-8 border-t pt-6">
                <h3 className="mb-4 font-semibold">
                  <T k="Collect credit without a new sale" />
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
            <h2 className="mb-5 text-lg font-semibold">
              <T k="End trip" />
            </h2>
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
            <h2 className="mb-5 text-xl font-bold">
              <T k="Verify physical returns" />
            </h2>
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
            <p className="font-semibold">
              <T k="Awaiting warehouse verification" />
            </p>
            <p className="mt-3 text-sm text-muted-foreground">
              <T k="Your declared returns are saved. Admin will check physical stock and resolve any discrepancies." />
            </p>
          </Card>
        )}
      {trip.status === "CLOSED" && (
        <Card>
          <h2 className="font-semibold">
            <T k="Physical trip closed" />
          </h2>
          <p className="mt-3 text-sm">{trip.close_reason}</p>
          <p className="mt-3 text-sm text-muted-foreground">
            <T k="Physical reconciliation remains independent of financial settlement. Historical visits and return checks are preserved." />
          </p>
        </Card>
      )}
      <Card>
        <h2 className="mb-5 text-lg font-semibold">
          <T k="Customer totals" />
        </h2>
        {groups.size === 0 ? (
          <p className="text-sm text-muted-foreground">
            <T k="No delivery visits recorded." />
          </p>
        ) : (
          Array.from(groups.entries()).map(([key, g]) => (
            <div
              className="border-b border-border py-3 last:border-0"
              key={key}
            >
              <p className="font-semibold">
                <T
                  k="{0} · {1} visit{2}"
                  values={[
                    g.name,
                    <Value key="v1" value={g.visits} />,
                    <Value key="v2" value={g.visits === 1 ? "" : "s"} />,
                  ]}
                />
              </p>
              <p className="mt-2 text-sm">
                <T
                  k="{0} full delivered · {1} empty collected · {2} cartons delivered"
                  values={[
                    g.full,
                    g.empty,
                    <Value key="v2" value={g.cartons} />,
                  ]}
                />
              </p>
            </div>
          ))
        )}
      </Card>
      <Card>
        <h2 className="mb-5 text-lg font-semibold">
          <T k="Separate visit history" />
        </h2>
        {w.visits.length === 0 && (
          <p className="text-sm text-muted-foreground">
            <T k="Every saved visit will appear here." />
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
                <DateValue value={v.created_at} time /> · {v.id}
              </p>
              {w.items
                .filter((i) => i.visit_id === v.id)
                .map((i) => (
                  <p className="text-sm" key={i.product_id}>
                    <T
                      k="{0}: {1} full · {2} empty · {3} cartons · Unit price NPR {4}"
                      values={[
                        w.products.find((p) => p.id === i.product_id)?.name,
                        <Value key="v1" value={i.full_jars} />,
                        <Value key="v2" value={i.empty_jars} />,
                        <Value key="v3" value={i.cartons} />,
                        <Value key="price" value={i.unit_price_snapshot} />,
                      ]}
                    />
                  </p>
                ))}
              <p className="text-sm">
                <T
                  k="Delivery value NPR {0} · {1} · Reported {2}"
                  values={[
                    <Value key="value" value={v.value_snapshot} />,
                    <Message key="method" value={payment?.selection} />,
                    payment?.reported_amount ? (
                      <Value key="reported" value={payment.reported_amount} />
                    ) : (
                      <T key="unspecified" k="not specified" />
                    ),
                  ]}
                />
              </p>
              <p className="text-xs text-amber-800">
                <Message
                  value={
                    f.available
                      ? f.sales.some((s) => s.visit_id === v.id)
                        ? "Invoice recorded; Fonepay requires reconciliation"
                        : w.items
                              .filter((i) => i.visit_id === v.id)
                              .every((i) => i.full_jars + i.cartons === 0)
                          ? "Empty-return visit; no new sale or invoice"
                          : "Legacy visit: finance has not been posted"
                      : "Finance migration required; legacy payment intent"
                  }
                />
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
                    <T
                      k="Invoice MK-{0} - outstanding NPR {1}"
                      values={[
                        i.number.padStart(8, "0"),
                        <Value key="v1" value={i.outstanding} />,
                      ]}
                    />
                  </Link>
                ))}
              {payment?.reference && (
                <p className="text-xs">
                  <T k="Reference: {0}" values={[payment.reference]} />
                </p>
              )}
              {v.notes && <p className="text-sm">{v.notes}</p>}
            </article>
          );
        })}
      </Card>
      {w.declarations.length > 0 && (
        <Card>
          <h2 className="mb-3 font-semibold">
            <T k="Driver return declaration" />
          </h2>
          {w.declarations.map((c) => (
            <p key={`${c.product_id}:${c.stock_kind}`} className="py-2 text-sm">
              {w.products.find((p) => p.id === c.product_id)?.name} ·{" "}
              <Message value={stockLabels[c.stock_kind]} />:{" "}
              <Value value={c.quantity} />
            </p>
          ))}
        </Card>
      )}
      {w.checks.map((check) => (
        <Card key={check.id}>
          <h2 className="font-semibold">
            <Message value={check.outcome} /> ·{" "}
            <DateValue value={check.created_at} time />
          </h2>
          <p className="my-3 text-sm">{check.reason}</p>
          {w.check_items
            .filter((i) => i.check_id === check.id)
            .map((i) => (
              <p
                className="py-2 text-sm"
                key={`${i.product_id}:${i.stock_kind}`}
              >
                <T
                  k="{0} · {1}: expected {2}, declared {3}, verified {4}"
                  values={[
                    w.products.find((p) => p.id === i.product_id)?.name,
                    <Message key="v1" value={stockLabels[i.stock_kind]} />,
                    <Value key="v2" value={i.expected} />,
                    <Value key="v3" value={i.declared} />,
                    <Value key="v4" value={i.actual} />,
                  ]}
                />
              </p>
            ))}
          {w.discrepancies
            .filter((d) => d.check_id === check.id)
            .map((d) => (
              <p
                className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900"
                key={d.id}
              >
                <T
                  k="Variance {0} · {1} · {2}"
                  values={[
                    <Value key="v0" value={d.actual - d.expected} />,
                    <Message
                      key="v1"
                      value={d.approved_by ? "Approved" : "Pending resolution"}
                    />,
                    d.resolution,
                  ]}
                />
              </p>
            ))}
        </Card>
      ))}
      <Card>
        <h2 className="mb-4 font-semibold">
          <T k="Immutable inventory journal" />
        </h2>
        {w.movements.length === 0 && (
          <p className="text-sm text-muted-foreground">
            <T k="No posted stock movements." />
          </p>
        )}
        {w.movements.map((m) => (
          <div
            key={m.id}
            className="border-b border-border py-3 text-sm last:border-0"
          >
            <p>
              <Message value={m.movement_type.replaceAll("_", " ")} /> ·{" "}
              {w.products.find((p) => p.id === m.product_id)?.name} ·{" "}
              <Message value={stockLabels[m.stock_kind]} /> ·{" "}
              <Value value={m.quantity} />
            </p>
            <p className="mt-1 break-words text-xs text-muted-foreground">
              <T
                k="{0} · Actor {1} · Day {2} {3}"
                values={[
                  <DateValue key="v0" value={m.created_at} time />,
                  m.actor_user_id,
                  <DateValue key="v2" value={trip.date_label} />,
                  m.visit_id && (
                    <T key="visit" k=" · Visit {0}" values={[m.visit_id]} />
                  ),
                ]}
              />
            </p>
          </div>
        ))}
      </Card>
      {dayOpen && admin && trip.status === "DRAFT" && (
        <Card>
          <h2 className="mb-4 font-semibold">
            <T k="Cancel draft" />
          </h2>
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
            <a href="#add-delivery">
              <T k="New Delivery" />
            </a>
          </Button>
          <Button asChild variant="outline" className="min-h-14">
            <a href="#submit-trip">
              <T k="End trip" />
            </a>
          </Button>
        </div>
      )}
    </div>
  );
}
