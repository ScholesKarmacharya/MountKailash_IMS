import Link from "next/link";
import {
  ArrowDownToLine,
  ArrowRight,
  Banknote,
  CalendarDays,
  CircleAlert,
  ClipboardCheck,
  Droplets,
  Package,
  Recycle,
  Truck,
  Wrench,
  ChevronDown,
} from "lucide-react";
import { T, Message, DateValue, Value, LocalizedSection } from "./localization";
import { Card } from "./ui/card";
import { Button } from "./ui/button";
import { OperationalRefresh } from "./operational-refresh";
import type { BusinessDay } from "@/data-access/business-days";
import type {
  DayDetail,
  DayReport,
  HistoryDay,
} from "@/domain/business-days/types";
import type { InventorySnapshot } from "@/data-access/inventory";
import type { Workspace } from "@/domain/operations/types";
import {
  overviewActivity,
  type overviewFinance,
  type overviewTripGroups,
} from "@/domain/operations/admin-overview";
import { roundLabel } from "@/domain/operations/driver-workspace";
import { roundStock } from "@/domain/operations/driver-workspace";
import { getOperations } from "@/services/operations";
import {
  stockKinds,
  stockLabels,
  stockTotals,
} from "@/domain/inventory/validation";
import { isOvernightDay } from "@/domain/business-days/time";
import { npr } from "@/domain/finance/money";

const actionClass =
  "inline-flex min-h-11 items-center gap-2 rounded-lg text-sm font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
export function OverviewHeader({
  day,
  latestDay,
  updatedAt,
}: {
  day: BusinessDay | null;
  latestDay: HistoryDay | null;
  updatedAt: string;
}) {
  const displayDay = day ?? latestDay;
  return (
    <Card
      className="border-l-4 border-l-primary p-4"
      data-testid="overview-business-day"
    >
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <CalendarDays
            className="size-5 shrink-0 text-primary"
            aria-hidden="true"
          />
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted-foreground">
              <T
                k={
                  day
                    ? "Business day"
                    : latestDay
                      ? "Last closed business day"
                      : "Business day"
                }
              />
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-2">
              <h2
                className="text-lg font-bold sm:text-xl"
                data-testid="overview-business-date"
              >
                {displayDay ? (
                  <DateValue value={displayDay.date_label} />
                ) : (
                  <T k="No active day" />
                )}
                {displayDay && (
                  <span className="ml-1 text-xs font-medium text-muted-foreground">
                    BS
                  </span>
                )}
              </h2>
              <span
                className={
                  "rounded-full px-2.5 py-1 text-xs font-semibold " +
                  (day?.status === "OPEN"
                    ? "bg-teal-50 text-teal-800"
                    : day
                      ? "bg-amber-50 text-amber-900"
                      : "bg-muted text-muted-foreground")
                }
              >
                <Message
                  value={
                    day?.status === "CLOSING_REVIEW"
                      ? "Closing Review"
                      : (day?.status ??
                        (latestDay ? "CLOSED" : "No active day"))
                  }
                />
              </span>
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
          <OperationalRefresh compact updatedAt={updatedAt} />
          <Button asChild variant="outline" className="shrink-0">
            <Link href="/admin/daily-close">
              <ClipboardCheck className="size-4" aria-hidden="true" />
              <T k="Review Daily Close" />
            </Link>
          </Button>
        </div>
      </div>
      {day && isOvernightDay(day.date_label) && (
        <p
          role="status"
          className="mt-3 border-t border-border pt-3 text-sm text-amber-900"
        >
          <T k="This business day continues from an earlier calendar date. Review it before starting another day." />
        </p>
      )}
      {!day && (
        <p className="mt-3 border-t border-border pt-3 text-sm text-muted-foreground">
          <T k="No open business day. Review daily history for closed-day totals or open a day from Daily Close." />
        </p>
      )}
    </Card>
  );
}

function SectionHeading({
  title,
  href,
  action,
}: {
  title: string;
  href: string;
  action: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
      <h2 className="text-lg font-bold">
        <Message value={title} />
      </h2>
      <Link href={href} className={actionClass}>
        <Message value={action} />
        <ArrowRight className="size-4" aria-hidden="true" />
      </Link>
    </div>
  );
}

export function OverviewStock({ inventory }: { inventory: InventorySnapshot }) {
  const totals = stockTotals(inventory.balances);
  const icons = {
    FULL_JAR: Droplets,
    EMPTY_JAR: Recycle,
    BOTTLE_CARTON: Package,
  };
  return (
    <LocalizedSection aria-label="Warehouse stock" className="space-y-2">
      <SectionHeading
        title="Warehouse stock"
        href="/admin/inventory"
        action="Manage Inventory"
      />
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        {stockKinds.map((kind) => {
          const Icon = icons[kind];
          return (
            <Card
              key={kind}
              className="flex min-w-0 items-center justify-between gap-2 p-3 sm:p-4"
            >
              <div>
                <h3 className="text-sm font-semibold text-muted-foreground">
                  <Message value={stockLabels[kind]} />
                </h3>
                <p
                  className="mt-2 break-all text-2xl font-bold tabular-nums text-primary sm:text-3xl"
                  data-testid={"overview-stock-" + kind}
                >
                  {inventory.available ? (
                    <Value value={totals[kind]} />
                  ) : (
                    <T k="Unavailable" />
                  )}
                </p>
              </div>
              <Icon
                className="hidden size-7 shrink-0 text-primary sm:block"
                aria-hidden="true"
              />
            </Card>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        <T k="Available in the warehouse. Vehicle stock is tracked separately." />
      </p>
    </LocalizedSection>
  );
}

export function OverviewFinance({
  metrics,
  dayOpen,
}: {
  metrics: ReturnType<typeof overviewFinance>;
  dayOpen: boolean;
}) {
  return (
    <LocalizedSection aria-label="Financial overview" className="space-y-2">
      <SectionHeading
        title="Financial overview"
        href="/admin/payments"
        action="View payments and credit"
      />
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {[
          ["Today's Sales", metrics.sales, "Sales excluding tax", "sales"],
          [
            "Confirmed Collections",
            metrics.collections,
            "Cash and verified Fonepay receipts",
            "collections",
          ],
          [
            "New Credit Issued",
            metrics.issued,
            "Credit recorded at sale",
            "issued",
          ],
          [
            "Total Outstanding Credit",
            metrics.outstanding,
            "Across all customers",
            "outstanding",
          ],
        ].map(([label, value, caption, id]) => (
          <Card key={id} className="min-w-0 p-4">
            <h3 className="text-sm font-semibold text-muted-foreground">
              <Message value={label} />
            </h3>
            <p
              className="mt-2 break-words text-base font-bold tabular-nums sm:text-lg xl:text-xl"
              data-testid={"overview-finance-" + id}
            >
              {metrics.available && (dayOpen || id === "outstanding") ? (
                <Value value={npr(value!)} />
              ) : metrics.available && !dayOpen ? (
                <T k="No active day" />
              ) : (
                <T k="Unavailable" />
              )}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              <Message value={caption} />
            </p>
          </Card>
        ))}
      </div>
      {!dayOpen && (
        <p className="text-xs text-muted-foreground">
          <T k="Daily figures require an open business day. Outstanding credit and deposits remain current." />
        </p>
      )}
      <details
        className="group rounded-xl border border-border bg-card px-4"
        data-testid="overview-finance-breakdown"
      >
        <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-3 text-sm font-semibold">
          <T k="Financial breakdown" />
          <ChevronDown
            className="size-4 shrink-0 group-open:rotate-180"
            aria-hidden="true"
          />
        </summary>
        <div className="border-t border-border pb-4 pt-3">
          <dl className="grid gap-x-5 gap-y-3 sm:grid-cols-2 xl:grid-cols-5">
            {[
              ["Cash Recorded", metrics.cash, "cash"],
              ["Fonepay Pending", metrics.pending, "pending"],
              ["Fonepay Verified", metrics.fonepay, "fonepay"],
              ["Credit Recovered", metrics.recovered, "recovered"],
              ["Refundable Deposit Liability", metrics.deposits, "deposits"],
            ].map(([label, value, id]) => (
              <div key={id} className="min-w-0">
                <dt className="text-xs text-muted-foreground">
                  <Message value={label} />
                </dt>
                <dd
                  className="mt-1 break-words text-sm font-semibold tabular-nums"
                  data-testid={"overview-finance-" + id}
                >
                  {metrics.available && (dayOpen || id === "deposits") ? (
                    <Value value={npr(value!)} />
                  ) : metrics.available && !dayOpen ? (
                    <T k="No active day" />
                  ) : (
                    <T k="Unavailable" />
                  )}
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            <T k="Collections include repayments of prior credit and deposit receipts. Deposits remain separate from sales. Fonepay requires explicit admin reconciliation." />
          </p>
        </div>
      </details>
    </LocalizedSection>
  );
}

export function OverviewTripStatus({
  groups,
  available,
  hasDay,
}: {
  groups: ReturnType<typeof overviewTripGroups>;
  available: boolean;
  hasDay: boolean;
}) {
  return (
    <LocalizedSection aria-label="Trip status" className="space-y-2">
      <SectionHeading
        title="Trip status"
        href="/admin/trips"
        action="View all trips"
      />
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {[
          ["Active Trips", groups.active, "active", "/admin/trips"],
          [
            "Awaiting Confirmation",
            groups.awaiting,
            "awaiting",
            "/admin/trips",
          ],
          [
            "Prepared for Future Dates",
            groups.prepared,
            "prepared",
            "#prepared-trips",
          ],
          ["Completed Today", groups.completed, "completed", "/admin/reports"],
        ].map(([label, value, id, href]) => (
          <Card key={id} className="min-w-0 p-4">
            <Link
              href={String(href)}
              className={actionClass + " text-foreground"}
            >
              <h3 className="text-sm font-semibold">
                <Message value={label} />
              </h3>
            </Link>
            <p
              className="mt-2 text-2xl font-bold tabular-nums"
              data-testid={"overview-trips-" + id}
            >
              {available && (hasDay || id === "prepared") ? (
                <Value value={value} />
              ) : (
                <T k="Unavailable" />
              )}
            </p>
          </Card>
        ))}
      </div>
      {hasDay && available && groups.ready > 0 && (
        <p className="text-sm text-muted-foreground">
          <T
            k="{0} today's trips are waiting for loading or ready to start."
            values={[groups.ready]}
          />
        </p>
      )}
    </LocalizedSection>
  );
}

export function OverviewClosing({
  detail,
  workspace,
  hasDay,
}: {
  detail: DayDetail | null;
  workspace: Workspace;
  hasDay: boolean;
}) {
  return (
    <Card className="min-w-0 space-y-3 p-4" data-testid="overview-closing">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-lg font-bold">
          <CircleAlert className="size-5 text-primary" aria-hidden="true" />
          <T k="Daily Closing Blockers" />
        </h2>
        {detail && (
          <span
            className={
              "rounded-full px-2.5 py-1 text-xs font-semibold " +
              (detail.blockers.length
                ? "bg-amber-50 text-amber-900"
                : "bg-teal-50 text-teal-800")
            }
          >
            <T k="{0} blockers" values={[detail.blockers.length]} />
          </span>
        )}
      </div>
      {!detail ? (
        <p className="text-sm text-muted-foreground">
          <T
            k={
              hasDay
                ? "Closing checklist could not be loaded. Review Daily Close before proceeding."
                : "No active business day"
            }
          />
        </p>
      ) : !detail.blockers.length ? (
        <p className="text-sm text-teal-800">
          <T k="No critical blockers detected. Check the physical stock and collection evidence before confirming." />
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {detail.blockers.map((blocker, i) => {
            const trip =
              blocker.code === "TRIP"
                ? workspace.trips.find(
                    (t) => blocker.href === "/admin/trips/" + t.id,
                  )
                : undefined;
            const vehicle =
              blocker.code === "VEHICLE_STOCK"
                ? /^Vehicle (.+) still holds stock; reconcile its trip\.$/.exec(
                    blocker.message,
                  )
                : null;
            const receipt =
              blocker.code === "FONEPAY"
                ? /^Receipt MK-P-(\d+) awaits Fonepay reconciliation\.$/.exec(
                    blocker.message,
                  )
                : null;
            return (
              <li key={blocker.code + i} className="py-2 first:pt-0">
                <Link
                  href={blocker.href}
                  className="flex min-h-11 items-start justify-between gap-3 rounded text-sm leading-relaxed text-foreground hover:text-primary focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <span>
                    {trip ? (
                      <T
                        k="Round #{0}: {1}. Review its loading or warehouse return before closing."
                        values={[
                          trip.trip_number,
                          <Message
                            key="status"
                            value={roundLabel(trip.status)}
                          />,
                        ]}
                      />
                    ) : vehicle ? (
                      <T
                        k="Vehicle {0} still holds stock; reconcile its trip."
                        values={[vehicle[1]]}
                      />
                    ) : receipt ? (
                      <T
                        k="Receipt MK-P-{0} awaits Fonepay reconciliation."
                        values={[receipt[1]]}
                      />
                    ) : (
                      <Message value={blocker.message} />
                    )}
                  </span>
                  <ArrowRight
                    className="mt-1 size-4 shrink-0 text-primary"
                    aria-hidden="true"
                  />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      <Link href="/admin/daily-close" className={actionClass}>
        <T k="Review Daily Close" />
        <ArrowRight className="size-4" aria-hidden="true" />
      </Link>
    </Card>
  );
}

export async function OverviewPrepared({
  report,
  groups,
}: {
  report?: DayReport;
  groups: ReturnType<typeof overviewTripGroups>;
}) {
  const prepared =
    report?.prepared_trips ??
    (await Promise.all(
      groups.future.map(async (t) => {
        const snapshot = await getOperations(true, t.id);
        const stock = roundStock(snapshot, t);
        return {
          ...t,
          scheduled_date: t.scheduled_date ?? t.date_label,
          full_jars: snapshot.available ? stock.loadedFull : null,
          cartons: snapshot.available ? stock.loadedCartons : null,
        };
      }),
    ));
  return (
    <Card
      id="prepared-trips"
      className="min-w-0 space-y-3 p-4"
      data-testid="overview-prepared"
    >
      <h2 className="flex items-center gap-2 text-lg font-bold">
        <CalendarDays className="size-5 text-primary" aria-hidden="true" />
        <T k="Prepared for Future Dates" />
      </h2>
      {!prepared.length ? (
        <p className="text-sm text-muted-foreground">
          <T k="No confirmed loads prepared for future dates." />
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {prepared.map((trip) => (
            <li key={trip.id} className="py-2 first:pt-0">
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <Link href={"/admin/trips/" + trip.id} className={actionClass}>
                  <T
                    k="{0} · Round #{1}"
                    values={[trip.driver_name, trip.trip_number]}
                  />
                </Link>
                <span className="rounded-full bg-teal-50 px-2 py-1 text-xs font-semibold text-teal-800">
                  <T k="Future prepared" />
                </span>
              </div>
              <p className="text-sm">
                <T k="Vehicle" />: {trip.plate_number} ·{" "}
                <DateValue value={trip.scheduled_date} />
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                <T k="Full jars loaded" />:{" "}
                {trip.full_jars === null ? (
                  <T k="Unavailable" />
                ) : (
                  <Value value={trip.full_jars} />
                )}{" "}
                · <T k="Cartons loaded" />:{" "}
                {trip.cartons === null ? (
                  <T k="Unavailable" />
                ) : (
                  <Value value={trip.cartons} />
                )}
              </p>
            </li>
          ))}
        </ul>
      )}
      {!!prepared.length && (
        <p className="text-xs text-muted-foreground">
          <T k="Confirmed loads stay on their vehicles until the scheduled delivery date." />
        </p>
      )}
      {!!groups.scheduled.length && (
        <details className="group border-t border-border pt-2">
          <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-2 text-sm font-semibold">
            <T k="Future trips awaiting loading" />
            <ChevronDown
              className="size-4 shrink-0 group-open:rotate-180"
              aria-hidden="true"
            />
          </summary>
          <ul className="space-y-2 pb-2 text-sm">
            {groups.scheduled.map((trip) => (
              <li key={trip.id}>
                <Link href={"/admin/trips/" + trip.id} className={actionClass}>
                  <T
                    k="{0} · Round #{1}"
                    values={[trip.driver_name, trip.trip_number]}
                  />
                </Link>
                <p>
                  {trip.plate_number} ·{" "}
                  <DateValue value={trip.scheduled_date ?? trip.date_label} /> ·{" "}
                  <T k="Waiting for warehouse loading" />
                </p>
              </li>
            ))}
          </ul>
        </details>
      )}
      {!!report?.carryovers?.length && (
        <details className="border-t border-border pt-2">
          <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold">
            <T k="Authorized carryover / pending settlement" />
          </summary>
          <ul className="space-y-2 pb-2 text-sm">
            {report.carryovers.map((c) => (
              <li key={c.id}>
                <Link
                  href={"/admin/trips/" + c.trip_id}
                  className={actionClass}
                >
                  <T
                    k="{0} · Round #{1}"
                    values={[c.driver_name, c.trip_number]}
                  />
                </Link>
                <p>
                  {c.plate_number} · {c.reason}
                </p>
              </li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}

export function OverviewActivity({
  report,
  workspace,
}: {
  report: DayReport;
  workspace: Workspace;
}) {
  const recent = overviewActivity(report, workspace);
  const icons = {
    load: Truck,
    return: ArrowDownToLine,
    delivery: Package,
    refill: Recycle,
    damage: CircleAlert,
    stock: Wrench,
    money: Banknote,
  };
  return (
    <Card className="space-y-3 p-4" data-testid="overview-activity">
      <SectionHeading
        title="Recent operational activity"
        href={"/admin/reports/" + report.day.id}
        action="View permanent audit records"
      />
      {!recent.length ? (
        <p className="text-sm text-muted-foreground">
          <T k="No operational activity recorded for this business day." />
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {recent.map((row) => {
            const Icon = icons[row.icon];
            return (
              <li
                key={row.id}
                className="flex min-w-0 gap-3 py-3 first:pt-0 last:pb-0"
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-teal-50 text-primary">
                  <Icon className="size-4" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <Link
                    href={row.href}
                    className={actionClass + " break-words text-foreground"}
                  >
                    <T
                      k={row.key}
                      values={row.values.map((value, index) =>
                        index === 1 && row.stockLabel === value ? (
                          <Message key={index} value={value} />
                        ) : typeof value === "number" ||
                          (row.icon === "money" && index === 0) ? (
                          <Value key={index} value={value} />
                        ) : (
                          value
                        ),
                      )}
                    />
                  </Link>
                  {row.context && (
                    <p className="mt-1 break-words text-xs text-muted-foreground">
                      {row.context}
                    </p>
                  )}
                  <p className="mt-1 text-xs text-muted-foreground">
                    <DateValue value={row.time} time />
                  </p>
                </div>
                <ArrowRight
                  className="mt-1 size-4 shrink-0 text-primary"
                  aria-hidden="true"
                />
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
