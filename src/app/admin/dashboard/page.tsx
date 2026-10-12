import { T, Message, DateValue, Value } from "@/components/localization";
import { FinanceOverview } from "@/components/finance-overview";
import { Card } from "@/components/ui/card";
import { TripList } from "@/components/trip-summary";
import { getAdminDashboard } from "@/services/dashboard";
import { isOvernightDay } from "@/domain/business-days/time";
import { WarehouseStock } from "@/components/warehouse-stock";
import Link from "next/link";
import { npr } from "@/domain/finance/money";
import { OperationalRefresh } from "@/components/operational-refresh";
import { AdminDriverActivity } from "@/components/admin-driver-activity";
export default async function Dashboard() {
  const { businessDay, inventory, operations, finance, dayDetail } =
    await getAdminDashboard();
  const recent = dayDetail
    ? [
        ...dayDetail.report.movements.map((m) => ({
          id: m.id,
          time: String(m.created_at),
          label: (
            <>
              <Message value={String(m.movement_type)} /> ·{" "}
              <Value value={String(m.quantity)} />{" "}
              <Message value={String(m.stock_kind)} />
            </>
          ),
        })),
        ...dayDetail.report.journal
          .filter((j) => ["CASH", "FONEPAY", "SALES"].includes(j.account))
          .map((j) => ({
            id: j.id,
            time: j.created_at,
            label: (
              <>
                <Message value={j.kind} /> · <Message value={j.account} /> ·{" "}
                <Value value={npr(j.amount)} />
              </>
            ),
          })),
        ...dayDetail.report.events
          .filter((e) => e.status === "PENDING")
          .map((e) => ({
            id: e.id,
            time: String(e.created_at),
            label: "Fonepay receipt recorded — pending reconciliation",
          })),
      ]
        .sort((a, b) => b.time.localeCompare(a.time))
        .slice(0, 6)
    : [];
  return (
    <div className="space-y-7">
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-primary">
          <T k="Warehouse overview" />
        </p>
        <h1 className="text-3xl font-bold">
          <T k="Operations dashboard" />
        </h1>
        <p className="mt-2 text-muted-foreground">
          <T k="Your business day, deliveries and balances in one place." />
        </p>
      </div>
      <Card className="border-l-4 border-l-primary">
        <OperationalRefresh />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold">
            <T k="Business day" />
          </h2>
          <span className="rounded-full bg-muted px-3 py-1 text-xs">
            <Message
              value={
                businessDay?.status.replaceAll("_", " ") ?? "No active day"
              }
            />
          </span>
        </div>
        {businessDay ? (
          <>
            <p className="mt-4 text-2xl font-bold">
              <DateValue value={businessDay.date_label} />
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              <T
                k="Opened {0} (Nepal time)"
                values={[
                  <DateValue key="v0" value={businessDay.opened_at} time />,
                ]}
              />
            </p>
            {isOvernightDay(businessDay.date_label) && (
              <p
                role="status"
                className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900"
              >
                <T k="This business day continues from an earlier calendar date. Review it before starting another day." />
              </p>
            )}
          </>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">
            <T k="No open business day is recorded. Open a day manually before posting operations. Existing stock and customer balances carry forward." />
          </p>
        )}
        <Link
          href="/admin/daily-close"
          className="mt-4 inline-block text-sm font-semibold text-primary underline"
        >
          <T k="Review and close business day" />
        </Link>
      </Card>
      <WarehouseStock
        balances={inventory.balances}
        available={inventory.available}
      />
      <Link
        className="inline-block text-sm font-semibold text-primary underline"
        href="/admin/inventory"
      >
        <T k="Manage warehouse inventory" />
      </Link>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Card>
          <h2 className="text-sm font-semibold">
            <T k="Pending trips" />
          </h2>
          <p className="my-5 text-3xl font-bold">
            {operations.available ? (
              <Value
                value={
                  operations.trips.filter(
                    (t) =>
                      t.business_day_id === businessDay?.id &&
                      ["SUBMITTED", "UNDER_REVIEW", "DISCREPANCY"].includes(
                        t.status,
                      ),
                  ).length
                }
              />
            ) : (
              <T k="Unavailable" />
            )}
          </p>
          <Link href="/admin/trips" className="text-sm text-primary underline">
            <T k="Review trip queue" />
          </Link>
        </Card>
        <Card>
          <h2 className="text-sm font-semibold">
            <T k="Completed trips this day" />
          </h2>
          <p className="my-5 text-3xl font-bold">
            {dayDetail || operations.available ? (
              <Value
                value={
                  dayDetail?.report.totals.completed_trips ??
                  (operations.available
                    ? operations.trips.filter(
                        (t) =>
                          t.business_day_id === businessDay?.id &&
                          t.status === "CLOSED",
                      ).length
                    : 0)
                }
              />
            ) : (
              <T k="Unavailable" />
            )}
          </p>
          <Link
            href="/admin/reports"
            className="text-sm text-primary underline"
          >
            <T k="View daily history" />
          </Link>
        </Card>
        <Card>
          <h2 className="text-sm font-semibold">
            <T k="Closing checklist" />
          </h2>
          <p className="my-5 text-3xl font-bold">
            <Message
              value={
                dayDetail
                  ? `${dayDetail.blockers.length} blockers`
                  : businessDay
                    ? "Review required"
                    : "No active day"
              }
            />
          </p>
          <Link
            href="/admin/daily-close"
            className="text-sm text-primary underline"
          >
            <T k="Check reconciliation" />
          </Link>
        </Card>
      </div>
      {dayDetail ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[
            ["Business-day sales", dayDetail.report.totals.sales],
            ["Confirmed collections", dayDetail.report.totals.collections],
            ["Cash recorded", dayDetail.report.totals.cash],
            ["Admin-reconciled Fonepay", dayDetail.report.totals.fonepay],
            ["Pending Fonepay", dayDetail.report.totals.pending_fonepay],
            ["New credit issued", dayDetail.report.totals.new_credit],
            [
              "Previous-day credit recovered",
              dayDetail.report.totals.old_credit_recovered,
            ],
            ["All outstanding credit", dayDetail.report.totals.outstanding],
            [
              "Refundable deposit liability",
              dayDetail.report.totals.deposit_liability,
            ],
          ].map(([label, value]) => (
            <Card key={label}>
              <h2 className="text-sm text-muted-foreground">
                <Message value={label} />
              </h2>
              <p className="mt-3 text-xl font-bold">
                <Value value={npr(value!)} />
              </p>
            </Card>
          ))}
        </div>
      ) : (
        <FinanceOverview finance={finance} day={businessDay?.id ?? null} />
      )}
      <Link href="/admin/payments" className="text-primary underline">
        <T k="View payments and credit" />
      </Link>
      <Card>
        <h2 className="mb-4 font-semibold">
          <T k="Open trip queue" />
        </h2>
        {operations.available ? (
          <TripList
            trips={operations.trips.filter(
              (t) =>
                t.business_day_id === businessDay?.id && t.status !== "CLOSED",
            )}
            admin
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            <T k="Sprint 2 migrations are required before trip data can load." />
          </p>
        )}
      </Card>
      {dayDetail && (
        <Card>
          <h2 className="mb-4 font-semibold">
            <T k="Recent operational activity" />
          </h2>
          {!recent.length ? (
            <p className="text-sm text-muted-foreground">
              <T k="No operational activity recorded for this business day." />
            </p>
          ) : (
            <ul className="space-y-3">
              {recent.map((m) => (
                <li key={m.id} className="text-sm">
                  <Message value={m.label} /> ·{" "}
                  <DateValue value={m.time} time />
                </li>
              ))}
            </ul>
          )}
          <Link
            href={`/admin/reports/${dayDetail.report.day.id}`}
            className="mt-4 inline-block text-primary underline"
          >
            <T k="View permanent audit records" />
          </Link>
        </Card>
      )}
      <p className="text-sm text-muted-foreground">
        <T k="Collections include repayments of prior credit and deposit receipts. Deposits remain separate from sales. Fonepay requires explicit admin reconciliation." />
      </p>
      <AdminDriverActivity
        overview={operations}
        finance={finance}
        day={businessDay?.id}
        openedAt={businessDay?.opened_at}
      />
    </div>
  );
}
