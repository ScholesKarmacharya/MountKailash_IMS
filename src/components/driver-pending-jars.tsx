"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowUpRight,
  Clock3,
  Package,
  Phone,
  Users,
  RotateCcw,
} from "lucide-react";
import type { Workspace, Trip } from "@/domain/operations/types";
import type { LocalState } from "@/domain/offline/types";
import type { PendingJarWorkspace } from "@/domain/operations/pending-jars";
import type { DeliveryCustomerContext } from "@/domain/operations/customer-context";
import {
  driverJarCustomers,
  driverJarSummary,
  filterDriverJars,
  driverJarActivities,
  type DriverJarCustomer,
  type DriverJarFilters,
} from "@/domain/operations/driver-jars";
import { resolvedCustomer } from "@/domain/offline/operations";
import { pendingDays } from "@/domain/operations/pending-age";
import { fetchCustomerContext } from "@/lib/customers/request";
import { Card } from "./ui/card";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { BsDateRange } from "./bs-date-picker";
import { T, Message, DateValue, Value, useLocale } from "./localization";

const statuses = {
  confirmed: "Server-confirmed",
  device: "Saved on Device",
  review: "Needs Review",
} as const;
export function DriverPendingJars({
  workspace,
  pending,
  state,
  trip,
  customer,
}: {
  workspace: Workspace;
  pending?: PendingJarWorkspace;
  state?: LocalState;
  trip?: Trip;
  customer?: string;
}) {
  const { t } = useLocale();
  const router = useRouter();
  const [selected, setSelected] = useState<string | null>(customer ?? null);
  const [filters, setFilters] = useState<DriverJarFilters>({
    search: "",
    from: "",
    to: "",
    sort: "highest",
  });
  const [datesOpen, setDatesOpen] = useState(false);
  const available = !!state || !!pending?.available;
  const rows = driverJarCustomers(workspace, pending, state);
  const shown = filterDriverJars(rows, filters);
  const totals = driverJarSummary(rows);
  const detail = selected
    ? rows.find((r) =>
        state
          ? resolvedCustomer(state, r.customer.id) ===
            resolvedCustomer(state, selected)
          : r.customer.id === selected,
      )
    : undefined;
  const changed = rows.some((r) => r.status !== "confirmed");
  return (
    <div className="space-y-5" data-testid="driver-pending-jars">
      <header>
        <h1 className="text-3xl font-bold">
          <T k="Unreturned Jars" />
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          <T k="See which customers still need to return jars." />
        </p>
      </header>
      {!available ? (
        <Card>
          <p role="status">
            <T k="Jar records are unavailable. Refresh online." />
          </p>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Summary
              label="Total Pending Jars"
              value={totals.total}
              icon={<Package className="size-4" />}
              testId="driver-pending-total"
            />
            <Summary
              label="Customers Pending"
              value={totals.customers}
              icon={<Users className="size-4" />}
              testId="driver-pending-customers"
            />
            <Summary
              label="Oldest Pending"
              value={totals.oldestDays}
              days
              icon={<Clock3 className="size-4" />}
              testId="driver-pending-oldest"
            />
          </div>
          {changed && (
            <p className="text-xs text-muted-foreground">
              <T k="Includes jars saved on this device." />
            </p>
          )}
          {selected ? (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setSelected(null);
                  if (customer) router.push("/driver/pending-jars");
                }}
              >
                <ArrowLeft className="size-4" aria-hidden="true" />
                <T k="Back to pending customers" />
              </Button>
              {detail ? (
                <DriverJarDetails
                  key={detail.customer.id}
                  row={detail}
                  workspace={workspace}
                  state={state}
                  trip={trip}
                  pending={pending}
                />
              ) : (
                <Card>
                  <p role="status">
                    <T k="Customer jar details are not available." />
                  </p>
                </Card>
              )}
            </>
          ) : (
            <>
              <Card className="space-y-3 p-4 sm:p-5">
                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(180px,0.7fr)]">
                  <label className="grid gap-2 text-sm font-medium">
                    <T k="Search customer" />
                    <Input
                      type="search"
                      placeholder={t("Name or phone")}
                      value={filters.search}
                      onChange={(e) =>
                        setFilters({ ...filters, search: e.target.value })
                      }
                    />
                  </label>
                  <label className="grid gap-2 text-sm font-medium">
                    <T k="Sort by" />
                    <select
                      className="min-h-11 min-w-0 rounded-md border border-input bg-background px-3 text-sm"
                      value={filters.sort}
                      onChange={(e) =>
                        setFilters({
                          ...filters,
                          sort: e.target.value as DriverJarFilters["sort"],
                        })
                      }
                    >
                      <option value="highest">
                        <T k="Highest pending first" />
                      </option>
                      <option value="oldest">
                        <T k="Oldest first" />
                      </option>
                      <option value="recent">
                        <T k="Recent activity" />
                      </option>
                    </select>
                  </label>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="text-sm"
                  aria-expanded={datesOpen}
                  onClick={() => setDatesOpen(!datesOpen)}
                >
                  <Clock3 className="size-4" aria-hidden="true" />
                  <T k="Filter delivery dates" />
                </Button>
                {(filters.from || filters.to) && (
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <DateValue value={filters.from} />
                    <span>–</span>
                    <DateValue value={filters.to} />
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setFilters({ ...filters, from: "", to: "" });
                        setDatesOpen(false);
                      }}
                    >
                      <T k="Clear dates" />
                    </Button>
                  </div>
                )}
                {datesOpen && (
                  <BsDateRange
                    key={`${filters.from}:${filters.to}`}
                    from={filters.from}
                    to={filters.to}
                    onChange={(from, to) =>
                      setFilters({ ...filters, from, to })
                    }
                  />
                )}
                {(filters.from || filters.to) && (
                  <p className="text-xs text-muted-foreground">
                    <T k="Counts include all pending jars for each customer." />
                  </p>
                )}
              </Card>
              {!shown.length ? (
                <Card>
                  <p className="text-sm text-muted-foreground" role="status">
                    <Message
                      value={
                        filters.search || filters.from || filters.to
                          ? "No customers match your filters."
                          : "No pending jars."
                      }
                    />
                  </p>
                </Card>
              ) : (
                <div className="grid gap-4 md:grid-cols-2">
                  {shown.map((row) => (
                    <button
                      key={row.customer.id}
                      type="button"
                      data-testid="driver-jar-card"
                      data-customer-id={row.customer.id}
                      aria-label={`${row.customer.name} · ${t("View Details")}`}
                      onClick={() => setSelected(row.customer.id)}
                      className="flex min-w-0 flex-col rounded-xl border border-border bg-card p-5 text-left shadow-sm transition-colors hover:border-primary/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <h2 className="min-w-0 break-words text-lg font-semibold leading-snug">
                          {row.customer.name}
                        </h2>
                        <span className="shrink-0 rounded-full bg-muted px-2 py-1 text-xs font-semibold text-primary">
                          <Message
                            value={row.customer.supply_type ?? "REGULAR"}
                          />
                        </span>
                      </div>
                      {row.customer.phone && (
                        <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
                          <Phone
                            className="size-3.5 shrink-0"
                            aria-hidden="true"
                          />
                          {row.customer.phone}
                        </p>
                      )}
                      <p className="mt-5 text-3xl font-bold tabular-nums text-primary">
                        <Value value={row.pending} />
                      </p>
                      <p className="mt-1 text-sm font-medium text-muted-foreground">
                        <T k="Pending Jars" />
                      </p>
                      <div className="mt-4 space-y-1.5 text-sm text-muted-foreground">
                        {row.oldest && (
                          <>
                            <p>
                              <T k="Since" />: <DateValue value={row.oldest} />
                            </p>
                            <p className="font-medium text-foreground">
                              <T
                                k="{0} days pending"
                                values={[pendingDays(row.oldest)]}
                              />
                            </p>
                          </>
                        )}
                        {row.lastReturn && (
                          <p>
                            <T k="Last Return" />:{" "}
                            <DateValue value={row.lastReturn} />
                          </p>
                        )}
                        {row.lots[0]?.round != null && (
                          <p>
                            <T k="Round #{0}" values={[row.lots[0].round]} />
                          </p>
                        )}
                      </div>
                      {row.status !== "confirmed" && (
                        <span className="mt-3 w-fit rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800">
                          <Message value={statuses[row.status]} />
                        </span>
                      )}
                      <div className="mt-5 flex-1" />
                      <div className="flex flex-wrap items-end justify-between gap-3 border-t border-border pt-4">
                        <div className="rounded-lg border border-primary/15 bg-primary/5 px-3 py-2 text-primary">
                          <p className="text-xs font-medium">
                            <T k="To Return" />
                          </p>
                          <p className="mt-1 text-lg font-bold tabular-nums">
                            <T k="{0} Jars" values={[row.pending]} />
                          </p>
                        </div>
                        <span className="inline-flex items-center gap-1 py-2 text-sm font-semibold text-primary">
                          <T k="View Details" />
                          <ArrowUpRight className="size-4" aria-hidden="true" />
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
function Summary({
  label,
  value,
  days = false,
  icon,
  testId,
}: {
  label: string;
  value: number | null;
  days?: boolean;
  icon: React.ReactNode;
  testId: string;
}) {
  return (
    <Card className="p-4 sm:p-5">
      <p className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <span className="text-primary" aria-hidden="true">
          {icon}
        </span>
        <Message value={label} />
      </p>
      <p
        className="mt-3 text-2xl font-bold tabular-nums text-primary"
        data-testid={testId}
      >
        {value === null ? (
          "—"
        ) : days ? (
          <T k="{0} days" values={[value]} />
        ) : (
          <Value value={value} />
        )}
      </p>
    </Card>
  );
}
function DriverJarDetails({
  row,
  workspace,
  state,
  trip,
  pending,
}: {
  row: DriverJarCustomer;
  workspace: Workspace;
  state?: LocalState;
  trip?: Trip;
  pending?: PendingJarWorkspace;
}) {
  const cached = state?.snapshot.contexts.find(
    (c) => c.customer.id === resolvedCustomer(state, row.customer.id),
  );
  const [lookup, setLookup] = useState<{
    revision: string;
    data?: DeliveryCustomerContext;
    error?: string;
  }>();
  const [retry, setRetry] = useState(0);
  const revision = `${row.customer.id}:${trip?.id ?? ""}:${row.pending}:${row.lots.map((l) => `${l.id}:${l.quantity}`).join(",")}:${workspace.custody_history
    .filter((e) => e.customer_id === row.customer.id)
    .map((e) => e.id)
    .join(",")}:${retry}`;
  const activeTrip = trip?.status === "ACTIVE" ? trip.id : undefined;
  useEffect(() => {
    if (state || !activeTrip) return;
    let cancelled = false;
    const controller = new AbortController();
    const timer = window.setTimeout(
      () => controller.abort(new DOMException("Timeout", "TimeoutError")),
      15000,
    );
    void fetchCustomerContext(activeTrip, row.customer.id, controller.signal)
      .then(({ data }) => {
        if (!controller.signal.aborted) setLookup({ revision, data });
      })
      .catch(() => {
        if (!cancelled)
          setLookup({
            revision,
            error: "Could not load jar activity. Try again.",
          });
      })
      .finally(() => window.clearTimeout(timer));
    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [activeTrip, revision, row.customer.id, state]);
  const fallback: DeliveryCustomerContext = {
    customer: row.customer,
    billing: null,
    credit: [],
    prices: [],
    credit_history: [],
    custody: workspace.custody.filter((c) => c.customer_id === row.customer.id),
    custody_history: workspace.custody_history.filter(
      (e) => e.customer_id === row.customer.id,
    ),
    pending_jars: pending?.rows.filter(
      (r) => r.customer_id === row.customer.id,
    ),
  };
  const context =
    cached ??
    (lookup?.revision === revision ? lookup.data : undefined) ??
    fallback;
  const activities = driverJarActivities(
    context,
    workspace,
    state,
    row.customer.id,
  );
  const loading = !state && !!activeTrip && lookup?.revision !== revision;
  return (
    <div className="space-y-4" data-testid="driver-jar-details">
      <Card className="space-y-3 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="break-words text-xl font-bold">
              {row.customer.name}
            </h2>
            {row.customer.phone && (
              <p className="mt-1 text-sm text-muted-foreground">
                {row.customer.phone}
              </p>
            )}
          </div>
          <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-semibold text-primary">
            <Message value={row.customer.supply_type ?? "REGULAR"} />
          </span>
        </div>
        <p className="text-3xl font-bold text-primary">
          <T k="{0} Pending Jars" values={[row.pending]} />
        </p>
        {row.status !== "confirmed" && (
          <p className="text-xs text-muted-foreground">
            <T k="Confirmed" />: <Value value={row.confirmed} /> ·{" "}
            <T k="Device change" />: <Value value={row.deviceChange} /> ·{" "}
            <Message value={statuses[row.status]} />
          </p>
        )}
        {row.lastDelivery && (
          <p className="text-sm text-muted-foreground">
            <T k="Last Delivery" />: <DateValue value={row.lastDelivery} />
          </p>
        )}
        {row.lastReturn && (
          <p className="text-sm text-muted-foreground">
            <T k="Last Return" />: <DateValue value={row.lastReturn} />
          </p>
        )}
      </Card>
      <Card className="space-y-3 p-5">
        <h3 className="font-semibold">
          <T k="Pending deliveries" />
        </h3>
        {!row.lots.length && (
          <p className="text-sm text-muted-foreground">
            <T k="No pending jars." />
          </p>
        )}
        <ul className="divide-y divide-border">
          {row.lots.map((lot) => (
            <li key={lot.id} className="space-y-1 py-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold">{lot.product_name}</p>
                <span className="font-bold text-primary">
                  <T k="{0} Jars" values={[lot.quantity]} />
                </span>
              </div>
              <p className="text-muted-foreground">
                <Message
                  value={
                    lot.correction ? "Balance correction" : "Original delivery"
                  }
                />
                : <DateValue value={lot.date} /> ·{" "}
                <T k="{0} days pending" values={[pendingDays(lot.date)]} />
              </p>
              {lot.round != null && (
                <p className="text-xs text-muted-foreground">
                  <T k="Round #{0}" values={[lot.round]} />
                </p>
              )}
              {lot.local && (
                <p className="text-xs text-amber-800">
                  <T k="Saved on Device" />
                </p>
              )}
            </li>
          ))}
        </ul>
      </Card>
      <Card className="space-y-3 p-5">
        <h3 className="font-semibold">
          <T k="Recent jar activity" />
        </h3>
        {loading && (
          <p role="status" className="text-sm text-muted-foreground">
            <T k="Loading jar activity…" />
          </p>
        )}
        {lookup?.revision === revision && lookup.error && (
          <div
            role="alert"
            className="flex flex-wrap items-center gap-2 text-sm"
          >
            <Message value={lookup.error} />
            <Button variant="outline" onClick={() => setRetry((n) => n + 1)}>
              <RotateCcw className="size-4" aria-hidden="true" />
              <T k="Retry" />
            </Button>
          </div>
        )}
        {!loading && !activities.length && (
          <p className="text-sm text-muted-foreground">
            <Message
              value={
                !state && !activeTrip
                  ? "Start your assigned round to load recent activity."
                  : "No jar activity"
              }
            />
          </p>
        )}
        <ol className="divide-y divide-border">
          {activities.map((a) => (
            <li key={a.id} className="space-y-2 py-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium">
                  <DateValue value={a.date} time />
                </p>
                <span className="rounded-full bg-muted px-2 py-1 text-xs text-primary">
                  <Message value={statuses[a.status]} />
                </span>
              </div>
              <p className="text-muted-foreground">{a.product}</p>
              <div className="grid grid-cols-2 gap-2">
                {a.delivered > 0 && (
                  <p>
                    <T k="Delivered" />:{" "}
                    <strong>
                      <Value value={a.delivered} />
                    </strong>
                  </p>
                )}
                {a.returned > 0 && (
                  <p>
                    <T k="Returned" />:{" "}
                    <strong>
                      <Value value={a.returned} />
                    </strong>
                  </p>
                )}
                {a.adjustment !== 0 && (
                  <p>
                    <T k="Balance correction" />:{" "}
                    <strong>
                      <Value value={a.adjustment} />
                    </strong>
                  </p>
                )}
                <p>
                  <T k="Balance after" />:{" "}
                  <strong>
                    <T k="{0} Jars" values={[a.balance]} />
                  </strong>
                </p>
              </div>
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}
