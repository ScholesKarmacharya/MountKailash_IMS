import { ProductDeliverySummary } from "./product-delivery-summary";
import { T, Message, DateValue, Value } from "@/components/localization";
import Link from "next/link";
import { Card } from "./ui/card";
import {
  groupedTrips,
  dayTripDeliveries,
} from "@/domain/business-days/reports";
import type { DayReport, AuditRow } from "@/domain/business-days/types";
import { npr } from "@/domain/finance/money";
import { stockLabels } from "@/domain/inventory/validation";
import { PendingJars } from "./pending-jars";
import { ClosingFinanceSummary } from "./closing-finance-summary";
import { ReportPanel, ReportTable } from "./report-ui";
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
    <div className="space-y-5" data-testid="day-report-workspace">
      {r.pending_jars && (
        <PendingJars
          workspace={{ available: true, rows: r.pending_jars }}
          admin
          title="Pending jars at report cutoff"
          asOf={r.day.closed_at}
        />
      )}
      <Card>
        <h2 className="text-xl font-semibold">
          <DateValue value={r.day.date_label} /> ·{" "}
          <Message value={r.day.status.replaceAll("_", " ")} />
        </h2>
        <p className="mt-2 text-sm">
          <T
            k="Opened {0} by {1}."
            values={[
              <DateValue key="v0" value={r.day.opened_at} time />,
              r.day.opened_by_name,
            ]}
          />
        </p>
        <p className="mt-2 text-sm">
          {r.day.closed_at ? (
            <T
              k="Closed {0} by {1}."
              values={[
                <DateValue key="date" value={r.day.closed_at} time />,
                r.day.closed_by_name,
              ]}
            />
          ) : (
            <T k="Live preview; totals may change while operations are open." />
          )}
        </p>
        {r.source === "ARCHIVED" && (
          <p className="mt-2 text-sm text-muted-foreground">
            <T k="Immutable closing archive, version 1. Later corrections are recorded separately below." />
          </p>
        )}
        {r.source === "LEGACY_RECONSTRUCTED" && (
          <p
            role="status"
            className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900"
          >
            <T k="This day predates closing snapshots. Its report is reconstructed from timestamped journals; no completed Sprint 4 cash handover or immutable archive is claimed." />
          </p>
        )}
        <div className="mt-4 flex flex-wrap gap-4 print:hidden">
          <Link
            className="inline-flex min-h-12 items-center rounded-lg border border-border px-4 font-medium text-primary"
            href={`/api/business-days/${r.day.id}/pdf`}
          >
            <T k="Download daily PDF" />
          </Link>
          <Link
            className="inline-flex min-h-12 items-center rounded-lg border border-border px-4 font-medium text-primary"
            href={`/api/business-days/${r.day.id}/csv`}
          >
            <T k="Download Excel-compatible CSV" />
          </Link>
        </div>
      </Card>
      <ClosingFinanceSummary report={r} />
      <Card>
        <h2 className="mb-4 text-xl font-semibold">
          <T k="Physical and trip totals" />
        </h2>
        <dl className="grid gap-4 sm:grid-cols-3">
          {[
            ["Total trips", r.totals.trips],
            ["Completed trips", r.totals.completed_trips],
            ["Pending trips", r.totals.pending_trips],
            [
              "Active trips",
              r.trips.filter((t) => t.status === "ACTIVE").length,
            ],
            [
              "Pending settlements",
              r.trips.filter((t) =>
                ["SUBMITTED", "UNDER_REVIEW", "DISCREPANCY"].includes(t.status),
              ).length,
            ],
            ["Full jars delivered", r.totals.full_jars],
            ["Empty jars collected", r.totals.empty_jars],
            ["Cartons sold", r.totals.cartons],
            ["Jars refilled", r.totals.refilled],
            ["Damaged jars", r.totals.damaged],
          ].map(([label, value]) => (
            <div key={label}>
              <dt className="text-sm text-muted-foreground">
                <Message value={label} />
              </dt>
              <dd className="mt-1 font-bold">
                <Value value={value} />
              </dd>
            </div>
          ))}
        </dl>
        {r.totals.trips === 0 && (
          <p className="mt-4 text-sm text-muted-foreground">
            <T k="No trips were recorded for this business day." />
          </p>
        )}
      </Card>
      <Card>
        <h2 className="mb-4 text-xl font-semibold">
          <T k="Warehouse opening and closing stock" />
        </h2>
        {!r.stock.length ? (
          <p>
            <T k="No catalog stock balances recorded." />
          </p>
        ) : (
          <ReportTable
            columns={[
              "Product",
              "Location",
              "Stock state",
              "Opening",
              "Closing",
            ]}
            empty="No catalog stock balances recorded."
            rows={r.stock.map((s) => ({
              id: `${s.location_id}-${s.product_id}-${s.stock_kind}`,
              cells: [
                s.name,
                s.location_name,
                <Message key="state" value={stockLabels[s.stock_kind]} />,
                <Value key="opening" value={s.opening} />,
                <Value key="closing" value={s.closing} />,
              ],
            }))}
          />
        )}
      </Card>
      {(["driver", "vehicle"] as const).map((dimension) => (
        <Card key={dimension}>
          <h2 className="mb-4 text-xl font-semibold">
            <T
              k="{0} totals"
              values={[
                <Message
                  key="v0"
                  value={dimension === "driver" ? "Driver" : "Vehicle"}
                />,
              ]}
            />
          </h2>
          <p className="mb-3 text-sm text-muted-foreground">
            <T k="Item sales before invoice-level corrections; confirmed collections include deposits and prior credit. Corrections appear in the audit records." />
          </p>
          {!groupedTrips(r, dimension).length ? (
            <p>
              <T k="No transactions recorded." />
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {groupedTrips(r, dimension).map((g) => (
                <li key={g.id} className="py-3">
                  <strong>{g.name}</strong>
                  <p className="mt-1 text-sm">
                    <T k="{0} trips" values={[g.trips]} />
                  </p>
                  {dayTripDeliveries(
                    r,
                    r.trips
                      .filter(
                        (trip) =>
                          (dimension === "driver"
                            ? trip.driver_id
                            : trip.vehicle_id) === g.id,
                      )
                      .map((trip) => trip.id),
                  ).map((line) => (
                    <ProductDeliverySummary
                      key={line.product_id}
                      line={line}
                      aggregate
                    />
                  ))}
                  <p className="mt-1 text-sm">
                    <T
                      k="Item sales {0} · collections {1}"
                      values={[
                        <Value key="v0" value={npr(g.sales)} />,
                        <Value key="v1" value={npr(g.collections)} />,
                      ]}
                    />
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ))}
      <Card>
        <h2 className="mb-4 text-xl font-semibold">
          <T k="Product totals" />
        </h2>
        {!r.products.length ? (
          <p>
            <T k="No deliveries recorded." />
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {r.products.map((p) => (
              <li key={p.product_id} className="py-3">
                {p.kind ? (
                  <ProductDeliverySummary
                    line={{ ...p, kind: p.kind }}
                    aggregate
                  />
                ) : (
                  <strong>{p.name}</strong>
                )}
                <p className="mt-1 text-sm">
                  <T k="Item sales before invoice corrections" />:{" "}
                  <Value value={npr(p.sales)} />
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card>
        <h2 className="mb-4 text-xl font-semibold">
          <T k="Customer transactions" />
        </h2>
        {!r.customers.length ? (
          <p>
            <T k="No customer visits recorded." />
          </p>
        ) : (
          <ul className="grid items-start gap-3 xl:grid-cols-2">
            {r.customers.map((c) => (
              <li
                key={c.id}
                className="min-w-0 space-y-2 rounded-lg border border-border p-4"
              >
                <strong>{c.name}</strong>
                <p className="mt-1 text-sm">
                  <T k="Trip #{0}" values={[c.trip_number]} /> ·{" "}
                  <DateValue value={c.created_at} time />
                </p>
                {(c.items ?? []).map((line) => (
                  <ProductDeliverySummary key={line.product_id} line={line} />
                ))}
                {c.invoice_id && (
                  <Link
                    href={`/admin/invoices/${c.invoice_id}`}
                    className="text-primary underline"
                  >
                    <T
                      k="Invoice MK-{0} · {1} + tax {2}"
                      values={[
                        c.invoice_number,
                        <Value key="v1" value={npr(c.sales)} />,
                        <Value key="v2" value={npr(c.tax)} />,
                      ]}
                    />
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
        <h3 className="mb-3 mt-6 font-semibold">
          <T k="Collections and prior-invoice allocations" />
        </h3>
        {!r.payments.length ? (
          <p>
            <T k="No receipts recorded or reconciled on this day." />
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {r.payments.map((p) => (
              <li key={p.id} className="py-3">
                <Link
                  href={`/admin/payments/${p.id}`}
                  className="font-semibold text-primary underline"
                >
                  <T
                    k="MK-P-{0} · {1}"
                    values={[p.number, p.customer_snapshot.name]}
                  />
                </Link>
                <p className="mt-1 text-sm">
                  <T
                    k="{0} · {1} · {2} (deposit {3})"
                    values={[
                      <Message key="v0" value={p.method} />,
                      <Message key="v1" value={p.status} />,
                      <Value key="v2" value={npr(p.amount)} />,
                      <Value key="v3" value={npr(p.deposit_amount)} />,
                    ]}
                  />
                </p>
                {p.allocations.map((a) => (
                  <p key={a.invoice_id} className="mt-1 text-sm">
                    <T
                      k="Invoice MK-{0} ({1}): {2}"
                      values={[
                        a.number,
                        <DateValue key="v1" value={a.date_label} />,
                        <Value key="v2" value={npr(a.amount)} />,
                      ]}
                    />
                  </p>
                ))}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <ReportPanel title="Trip reconciliation records" collapsed>
        {!r.trips.length ? (
          <p>
            <T k="No trips to reconcile." />
          </p>
        ) : (
          r.trips.map((t) => (
            <details key={t.id} className="border-b border-border py-3">
              <summary className="cursor-pointer font-semibold">
                <T
                  k="Trip #{0} · {1} · {2} · {3}"
                  values={[
                    t.trip_number,
                    t.driver_name,
                    t.plate_number,
                    <Message key="v3" value={t.status} />,
                  ]}
                />
              </summary>
              <div className="mt-3 space-y-3 text-sm">
                <Link
                  href={`/admin/trips/${t.id}`}
                  className="text-primary underline"
                >
                  <T k="Open trip" />
                </Link>
                <p>{t.close_reason || <T k="No closing reason recorded." />}</p>
                {!t.checks.length && (
                  <p>
                    <T k="No physical return checks (an unladen draft can be cancelled)." />
                  </p>
                )}
                {t.checks.map((c) => (
                  <div key={c.id}>
                    <p>
                      <Message value={c.outcome} />: {c.reason}
                    </p>
                    <ul>
                      {c.items.map((i) => (
                        <li key={`${i.product_id}-${i.stock_kind}`}>
                          <T
                            k="{0}: expected {1}, declared {2}, actual {3}"
                            values={[
                              <Message
                                key="v0"
                                value={stockLabels[i.stock_kind]}
                              />,
                              <Value key="v1" value={i.expected} />,
                              <Value key="v2" value={i.declared} />,
                              <Value key="v3" value={i.actual} />,
                            ]}
                          />
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </details>
          ))
        )}
      </ReportPanel>
      <ReportPanel title="Refilling and damaged jars" collapsed>
        {!r.processing.length ? (
          <p>
            <T k="No warehouse processing recorded." />
          </p>
        ) : (
          r.processing.map((p) => (
            <p key={p.id} className="py-2 text-sm">
              <Message value={p.operation} /> · {p.product_name} ·{" "}
              <Value value={p.quantity} />{" "}
              <Message value={stockLabels[p.stock_kind]} /> · {p.actor_name} ·{" "}
              {p.reason} · <DateValue value={p.created_at} time />
            </p>
          ))
        )}
      </ReportPanel>
      <ReportPanel title="Carry-forward balances" collapsed>
        <p className="mb-4 text-sm text-muted-foreground">
          <T k="Opening the next day preserves these cumulative ledgers and stock; only the next day’s activity counters begin at zero." />
        </p>
        {r.custody.map((c) => (
          <p key={`${c.customer_id}-${c.product_id}`} className="py-1 text-sm">
            <T
              k="{0} · {1}: {2} jars held"
              values={[
                c.name,
                c.product_name,
                <Value key="v2" value={c.quantity} />,
              ]}
            />
          </p>
        ))}
        {r.credit.map((c) => (
          <p key={c.customer_id} className="py-1 text-sm">
            <T
              k="{0}: receivable {1}"
              values={[c.name, <Value key="v1" value={npr(c.outstanding)} />]}
            />
          </p>
        ))}
        {r.deposit_balances.map((c) => (
          <p key={c.customer_id} className="py-1 text-sm">
            <T
              k="{0}: refundable deposit {1}"
              values={[c.name, <Value key="v1" value={npr(c.liability)} />]}
            />
          </p>
        ))}
        {!r.custody.length &&
          !r.credit.length &&
          !r.deposit_balances.length && (
            <p>
              <T k="No customer balances recorded." />
            </p>
          )}
      </ReportPanel>
      {r.reconciliation && (
        <Card>
          <h2 className="mb-3 text-xl font-semibold">
            <T k="Closing reconciliation" />
          </h2>
          <p>
            <T
              k="Net cash {0} · discrepancy {1}"
              values={[
                <Value key="v0" value={npr(r.reconciliation.cash_counted)} />,
                <Value
                  key="v1"
                  value={npr(r.reconciliation.cash_difference)}
                />,
              ]}
            />
          </p>
          <p className="mt-3 break-words text-sm">{r.reconciliation.notes}</p>
        </Card>
      )}
      <Card>
        <h2 className="mb-4 text-xl font-semibold">
          <T k="Discrepancies, corrections and journals" />
        </h2>
        {audits.map(([label, items]) => (
          <details key={label} className="py-2">
            <summary className="cursor-pointer font-medium">
              <Message value={label} /> (<Value value={items.length} />)
            </summary>
            {!items.length ? (
              <p className="mt-2 text-sm">
                <T k="No records." />
              </p>
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
                            <Message value={key.replaceAll("_", " ")} />
                          </dt>
                          <dd className="mt-1 break-all">
                            {key === "created_at" ? (
                              <DateValue value={String(v)} time />
                            ) : [
                                "amount",
                                "subtotal_delta",
                                "tax_delta",
                              ].includes(key) ? (
                              <Value value={npr(String(v))} />
                            ) : [
                                "status",
                                "kind",
                                "account",
                                "stock_kind",
                                "operation",
                                "source",
                                "outcome",
                              ].includes(key) ? (
                              <Message value={String(v).replaceAll("_", " ")} />
                            ) : typeof v === "number" ? (
                              <Value value={v} />
                            ) : (
                              String(v)
                            )}
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
