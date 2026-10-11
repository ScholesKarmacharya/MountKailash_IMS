import { FinanceOverview } from "@/components/finance-overview";
import { Card } from "@/components/ui/card";
import { TripList } from "@/components/trip-summary";
import { getAdminDashboard } from "@/services/dashboard";
import { formatNepalTime, isOvernightDay } from "@/domain/business-days/time";
import { WarehouseStock } from "@/components/warehouse-stock";
import Link from "next/link";
import { npr } from "@/domain/finance/money";
export default async function Dashboard() {
  const { businessDay, inventory, operations, finance, dayDetail } =
    await getAdminDashboard();
  const recent = dayDetail
    ? [
        ...dayDetail.report.movements.map((m) => ({
          id: m.id,
          time: String(m.created_at),
          label: `${String(m.movement_type).replaceAll("_", " ")} · ${String(m.quantity)} ${String(m.stock_kind).replaceAll("_", " ")}`,
        })),
        ...dayDetail.report.journal
          .filter((j) => ["CASH", "FONEPAY", "SALES"].includes(j.account))
          .map((j) => ({
            id: j.id,
            time: j.created_at,
            label: `${j.kind.replaceAll("_", " ")} · ${j.account} · ${npr(j.amount)}`,
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
          Warehouse overview
        </p>
        <h1 className="text-3xl font-bold">Operations dashboard</h1>
        <p className="mt-2 text-muted-foreground">
          Your business day, deliveries and balances in one place.
        </p>
      </div>
      <Card className="border-l-4 border-l-primary">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold">Business day</h2>
          <span className="rounded-full bg-muted px-3 py-1 text-xs">
            {businessDay?.status.replaceAll("_", " ") ?? "No active day"}
          </span>
        </div>
        {businessDay ? (
          <>
            <p className="mt-4 text-2xl font-bold">{businessDay.date_label}</p>
            <p className="mt-2 text-sm text-muted-foreground">
              Opened {formatNepalTime(businessDay.opened_at)} (Nepal time)
            </p>
            {isOvernightDay(businessDay.date_label) && (
              <p
                role="status"
                className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900"
              >
                This business day continues from an earlier calendar date.
                Review it before starting another day.
              </p>
            )}
          </>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">
            No open business day is recorded. Open a day manually before posting
            operations. Existing stock and customer balances carry forward.
          </p>
        )}
        <Link
          href="/admin/daily-close"
          className="mt-4 inline-block text-sm font-semibold text-primary underline"
        >
          Review and close business day
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
        Manage warehouse inventory
      </Link>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Card>
          <h2 className="text-sm font-semibold">Pending trips</h2>
          <p className="my-5 text-3xl font-bold">
            {operations.available
              ? operations.trips.filter(
                  (t) =>
                    t.business_day_id === businessDay?.id &&
                    ["SUBMITTED", "UNDER_REVIEW", "DISCREPANCY"].includes(
                      t.status,
                    ),
                ).length
              : "Unavailable"}
          </p>
          <Link href="/admin/trips" className="text-sm text-primary underline">
            Review trip queue
          </Link>
        </Card>
        <Card>
          <h2 className="text-sm font-semibold">Completed trips this day</h2>
          <p className="my-5 text-3xl font-bold">
            {dayDetail?.report.totals.completed_trips ??
              (operations.available
                ? operations.trips.filter(
                    (t) =>
                      t.business_day_id === businessDay?.id &&
                      t.status === "CLOSED",
                  ).length
                : "Unavailable")}
          </p>
          <Link
            href="/admin/reports"
            className="text-sm text-primary underline"
          >
            View daily history
          </Link>
        </Card>
        <Card>
          <h2 className="text-sm font-semibold">Closing checklist</h2>
          <p className="my-5 text-3xl font-bold">
            {dayDetail
              ? `${dayDetail.blockers.length} blockers`
              : businessDay
                ? "Review required"
                : "No active day"}
          </p>
          <Link
            href="/admin/daily-close"
            className="text-sm text-primary underline"
          >
            Check reconciliation
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
              <h2 className="text-sm text-muted-foreground">{label}</h2>
              <p className="mt-3 text-xl font-bold">{npr(value!)}</p>
            </Card>
          ))}
        </div>
      ) : (
        <FinanceOverview finance={finance} day={businessDay?.id ?? null} />
      )}
      <Link href="/admin/payments" className="text-primary underline">
        View payments and credit
      </Link>
      <Card>
        <h2 className="mb-4 font-semibold">Open trip queue</h2>
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
            Sprint 2 migrations are required before trip data can load.
          </p>
        )}
      </Card>
      {dayDetail && (
        <Card>
          <h2 className="mb-4 font-semibold">Recent operational activity</h2>
          {!recent.length ? (
            <p className="text-sm text-muted-foreground">
              No operational activity recorded for this business day.
            </p>
          ) : (
            <ul className="space-y-3">
              {recent.map((m) => (
                <li key={m.id} className="text-sm">
                  {m.label} · {formatNepalTime(m.time)}
                </li>
              ))}
            </ul>
          )}
          <Link
            href={`/admin/reports/${dayDetail.report.day.id}`}
            className="mt-4 inline-block text-primary underline"
          >
            View permanent audit records
          </Link>
        </Card>
      )}
      <p className="text-sm text-muted-foreground">
        Collections include repayments of prior credit and deposit receipts.
        Deposits remain separate from sales. Fonepay requires explicit admin
        reconciliation.
      </p>
    </div>
  );
}
