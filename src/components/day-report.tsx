import Link from "next/link";
import { Card } from "./ui/card";
import { amountLabels, groupedTrips } from "@/domain/business-days/reports";
import type { DayReport, AuditRow } from "@/domain/business-days/types";
import { formatNepalTime } from "@/domain/business-days/time";
import { npr } from "@/domain/finance/money";
import { stockLabels } from "@/domain/inventory/validation";
import { PendingJars } from "./pending-jars";
export function DayReportView({ report: r }: { report: DayReport }) {
  const audits: [string, AuditRow[]][] = [
    ["Stock adjustments", r.adjustments],
    ["Invoice corrections", r.invoice_adjustments],
    ["Trip discrepancies", r.discrepancies],
    ["Stock movements", r.movements],
    ["Finance journal", r.journal],
    ["Deposit ledger", r.deposits],
    ["Payment verification", r.events],
  ];
  return (
    <div className="space-y-6">
      {r.pending_jars && (
        <PendingJars
          workspace={{ available: true, rows: r.pending_jars }}
          admin
          title="Pending jars at report cutoff"
        />
      )}
      <Card>
        <h2 className="text-xl font-semibold">
          {r.day.date_label} · {r.day.status.replaceAll("_", " ")}
        </h2>
        <p className="mt-2 text-sm">
          Opened {formatNepalTime(r.day.opened_at)} by {r.day.opened_by_name}.
        </p>
        <p className="mt-2 text-sm">
          {r.day.closed_at
            ? `Closed ${formatNepalTime(r.day.closed_at)} by ${r.day.closed_by_name}.`
            : "Live preview; totals may change while operations are open."}
        </p>
        {r.source === "ARCHIVED" && (
          <p className="mt-2 text-sm text-muted-foreground">
            Immutable closing archive, version 1. Later corrections are recorded
            separately below.
          </p>
        )}
        {r.source === "LEGACY_RECONSTRUCTED" && (
          <p
            role="status"
            className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900"
          >
            This day predates closing snapshots. Its report is reconstructed
            from timestamped journals; no completed Sprint 4 cash handover or
            immutable archive is claimed.
          </p>
        )}
        <div className="mt-4 flex flex-wrap gap-4 print:hidden">
          <Link
            className="text-primary underline"
            href={`/api/business-days/${r.day.id}/pdf`}
          >
            Download daily PDF
          </Link>
          <Link
            className="text-primary underline"
            href={`/api/business-days/${r.day.id}/csv`}
          >
            Download Excel-compatible CSV
          </Link>
        </div>
      </Card>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Object.entries(amountLabels).map(([key, label]) => (
          <Card key={key}>
            <h3 className="text-sm text-muted-foreground">{label}</h3>
            <p className="mt-3 text-xl font-bold">
              {npr(r.totals[key as keyof typeof amountLabels])}
            </p>
          </Card>
        ))}
      </div>
      <Card>
        <h2 className="mb-4 text-xl font-semibold">Physical and trip totals</h2>
        <dl className="grid gap-4 sm:grid-cols-3">
          {[
            ["Total trips", r.totals.trips],
            ["Completed trips", r.totals.completed_trips],
            ["Pending trips", r.totals.pending_trips],
            ["Full jars delivered", r.totals.full_jars],
            ["Empty jars collected", r.totals.empty_jars],
            ["Cartons sold", r.totals.cartons],
            ["Jars refilled", r.totals.refilled],
            ["Damaged jars", r.totals.damaged],
          ].map(([label, value]) => (
            <div key={label}>
              <dt className="text-sm text-muted-foreground">{label}</dt>
              <dd className="mt-1 font-bold">{value}</dd>
            </div>
          ))}
        </dl>
        {r.totals.trips === 0 && (
          <p className="mt-4 text-sm text-muted-foreground">
            No trips were recorded for this business day.
          </p>
        )}
      </Card>
      <Card>
        <h2 className="mb-4 text-xl font-semibold">
          Warehouse opening and closing stock
        </h2>
        {!r.stock.length ? (
          <p>No catalog stock balances recorded.</p>
        ) : (
          <ul className="divide-y divide-border">
            {r.stock.map((s) => (
              <li
                key={`${s.location_id}-${s.product_id}-${s.stock_kind}`}
                className="flex flex-wrap justify-between gap-3 py-3"
              >
                <span>
                  {s.location_name} · {s.name} · {stockLabels[s.stock_kind]}
                </span>
                <strong>
                  {s.opening} → {s.closing}
                </strong>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {(["driver", "vehicle"] as const).map((dimension) => (
        <Card key={dimension}>
          <h2 className="mb-4 text-xl font-semibold">
            {dimension === "driver" ? "Driver" : "Vehicle"} totals
          </h2>
          <p className="mb-3 text-sm text-muted-foreground">
            Item sales before invoice-level corrections; confirmed collections
            include deposits and prior credit. Corrections appear in the audit
            records.
          </p>
          {!groupedTrips(r, dimension).length ? (
            <p>No transactions recorded.</p>
          ) : (
            <ul className="divide-y divide-border">
              {groupedTrips(r, dimension).map((g) => (
                <li key={g.id} className="py-3">
                  <strong>{g.name}</strong>
                  <p className="mt-1 text-sm">
                    {g.trips} trips · {g.full_jars} full jars · {g.empty_jars}{" "}
                    empties · {g.cartons} cartons
                  </p>
                  <p className="mt-1 text-sm">
                    Item sales {npr(g.sales)} · collections {npr(g.collections)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ))}
      <Card>
        <h2 className="mb-4 text-xl font-semibold">Product totals</h2>
        {!r.products.length ? (
          <p>No deliveries recorded.</p>
        ) : (
          <ul className="divide-y divide-border">
            {r.products.map((p) => (
              <li key={p.product_id} className="py-3">
                <strong>{p.name}</strong>
                <p className="mt-1 text-sm">
                  {p.full_jars} full · {p.empty_jars} empty · {p.cartons}{" "}
                  cartons · item sales {npr(p.sales)} before invoice corrections
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card>
        <h2 className="mb-4 text-xl font-semibold">Customer transactions</h2>
        {!r.customers.length ? (
          <p>No customer visits recorded.</p>
        ) : (
          <ul className="divide-y divide-border">
            {r.customers.map((c) => (
              <li key={c.id} className="py-3">
                <strong>{c.name}</strong>
                <p className="mt-1 text-sm">
                  Trip #{c.trip_number} · {formatNepalTime(c.created_at)} ·{" "}
                  {c.full_jars} full / {c.empty_jars} empties / {c.cartons}{" "}
                  cartons
                </p>
                {c.invoice_id && (
                  <Link
                    href={`/admin/invoices/${c.invoice_id}`}
                    className="text-primary underline"
                  >
                    Invoice MK-{c.invoice_number} · {npr(c.sales)} + tax{" "}
                    {npr(c.tax)}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
        <h3 className="mb-3 mt-6 font-semibold">
          Collections and prior-invoice allocations
        </h3>
        {!r.payments.length ? (
          <p>No receipts recorded or reconciled on this day.</p>
        ) : (
          <ul className="divide-y divide-border">
            {r.payments.map((p) => (
              <li key={p.id} className="py-3">
                <Link
                  href={`/admin/payments/${p.id}`}
                  className="font-semibold text-primary underline"
                >
                  MK-P-{p.number} · {p.customer_snapshot.name}
                </Link>
                <p className="mt-1 text-sm">
                  {p.method} · {p.status} · {npr(p.amount)} (deposit{" "}
                  {npr(p.deposit_amount)})
                </p>
                {p.allocations.map((a) => (
                  <p key={a.invoice_id} className="mt-1 text-sm">
                    Invoice MK-{a.number} ({a.date_label}): {npr(a.amount)}
                  </p>
                ))}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card>
        <h2 className="mb-4 text-xl font-semibold">
          Trip reconciliation records
        </h2>
        {!r.trips.length ? (
          <p>No trips to reconcile.</p>
        ) : (
          r.trips.map((t) => (
            <details key={t.id} className="border-b border-border py-3">
              <summary className="cursor-pointer font-semibold">
                Trip #{t.trip_number} · {t.driver_name} · {t.plate_number} ·{" "}
                {t.status}
              </summary>
              <div className="mt-3 space-y-3 text-sm">
                <Link
                  href={`/admin/trips/${t.id}`}
                  className="text-primary underline"
                >
                  Open trip
                </Link>
                <p>{t.close_reason || "No closing reason recorded."}</p>
                {!t.checks.length && (
                  <p>
                    No physical return checks (an unladen draft can be
                    cancelled).
                  </p>
                )}
                {t.checks.map((c) => (
                  <div key={c.id}>
                    <p>
                      {c.outcome}: {c.reason}
                    </p>
                    <ul>
                      {c.items.map((i) => (
                        <li key={`${i.product_id}-${i.stock_kind}`}>
                          {stockLabels[i.stock_kind]}: expected {i.expected},
                          declared {i.declared}, actual {i.actual}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </details>
          ))
        )}
      </Card>
      <Card>
        <h2 className="mb-4 text-xl font-semibold">
          Refilling and damaged jars
        </h2>
        {!r.processing.length ? (
          <p>No warehouse processing recorded.</p>
        ) : (
          r.processing.map((p) => (
            <p key={p.id} className="py-2 text-sm">
              {p.operation} · {p.product_name} · {p.quantity}{" "}
              {stockLabels[p.stock_kind]} · {p.actor_name} · {p.reason} ·{" "}
              {formatNepalTime(p.created_at)}
            </p>
          ))
        )}
      </Card>
      <Card>
        <h2 className="mb-4 text-xl font-semibold">Carry-forward balances</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          Opening the next day preserves these cumulative ledgers and stock;
          only the next day’s activity counters begin at zero.
        </p>
        {r.custody.map((c) => (
          <p key={`${c.customer_id}-${c.product_id}`} className="py-1 text-sm">
            {c.name} · {c.product_name}: {c.quantity} jars held
          </p>
        ))}
        {r.credit.map((c) => (
          <p key={c.customer_id} className="py-1 text-sm">
            {c.name}: receivable {npr(c.outstanding)}
          </p>
        ))}
        {r.deposit_balances.map((c) => (
          <p key={c.customer_id} className="py-1 text-sm">
            {c.name}: refundable deposit {npr(c.liability)}
          </p>
        ))}
        {!r.custody.length &&
          !r.credit.length &&
          !r.deposit_balances.length && <p>No customer balances recorded.</p>}
      </Card>
      {r.reconciliation && (
        <Card>
          <h2 className="mb-3 text-xl font-semibold">Closing reconciliation</h2>
          <p>
            Net cash {npr(r.reconciliation.cash_counted)} · discrepancy{" "}
            {npr(r.reconciliation.cash_difference)}
          </p>
          <p className="mt-3 break-words text-sm">{r.reconciliation.notes}</p>
        </Card>
      )}
      <Card>
        <h2 className="mb-4 text-xl font-semibold">
          Discrepancies, corrections and journals
        </h2>
        {audits.map(([label, items]) => (
          <details key={label} className="py-2">
            <summary className="cursor-pointer font-medium">
              {label} ({items.length})
            </summary>
            {!items.length ? (
              <p className="mt-2 text-sm">No records.</p>
            ) : (
              <div className="mt-3 space-y-3">
                {items.map((item) => (
                  <dl
                    key={item.id}
                    className="grid gap-x-5 gap-y-2 rounded-lg bg-muted p-4 text-sm sm:grid-cols-2"
                  >
                    {Object.entries(item)
                      .filter(([, v]) => v !== null && typeof v !== "object")
                      .map(([key, v]) => (
                        <div key={key} className="min-w-0">
                          <dt className="text-xs font-semibold capitalize text-muted-foreground">
                            {key.replaceAll("_", " ")}
                          </dt>
                          <dd className="mt-1 break-all">
                            {key === "created_at"
                              ? formatNepalTime(String(v))
                              : [
                                    "amount",
                                    "subtotal_delta",
                                    "tax_delta",
                                  ].includes(key)
                                ? npr(String(v))
                                : String(v).replaceAll("_", " ")}
                          </dd>
                        </div>
                      ))}
                  </dl>
                ))}
              </div>
            )}
          </details>
        ))}
      </Card>
    </div>
  );
}
