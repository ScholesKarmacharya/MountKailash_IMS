"use client";
import Link from "next/link";
import { BsDateRange } from "./bs-date-picker";
import { inDateRange, shiftDate } from "@/domain/localization/calendar";
import { nepalDateLabel } from "@/domain/business-days/time";
import {
  invoicePaymentStatus,
  invoiceTotals,
  invoiceFreeValue,
} from "@/domain/finance/reports";
import { npr } from "@/domain/finance/money";
import type { DriverData } from "./driver-application";
import type { LocalState, DeliveryDraft } from "@/domain/offline/types";
import { T, Message, DateValue, Value } from "./localization";
import { Card } from "./ui/card";
import { Button } from "./ui/button";
import { ProductDeliverySummary } from "./product-delivery-summary";
import { productDeliveries } from "@/domain/operations/product-delivery";
import { TripList } from "./trip-list";
import { DriverMoney } from "./driver-stock";

function HistoryCard({
  name,
  amount,
  status,
  at,
  summary,
  children,
}: {
  name: string;
  amount: string;
  status: string;
  at: string;
  summary?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <details
      className="rounded-xl border border-border bg-card"
      data-testid="driver-history-card"
    >
      <summary className="cursor-pointer list-none p-4">
        <div className="flex items-start justify-between gap-3">
          <span className="font-semibold">{name}</span>
          <span className="shrink-0 font-bold text-primary">
            <Value value={npr(amount)} />
          </span>
        </div>
        {summary && (
          <p className="mt-1 text-xs text-muted-foreground">{summary}</p>
        )}
        <div className="mt-2 flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
          <span>
            <Message value={status} /> · <DateValue value={at} time />
          </span>
          <span className="font-semibold text-primary">
            <T k="View Details" />
          </span>
        </div>
      </summary>
      <div className="space-y-3 border-t border-border p-4 text-sm">
        {children}
      </div>
    </details>
  );
}
export function DriverSalesView({
  data,
  state,
  q,
}: {
  data: DriverData;
  state?: LocalState;
  q: { from?: string; to?: string };
}) {
  const { finance: f } = data;
  const today = nepalDateLabel(new Date());
  const day = data.day?.date_label ?? today;
  const custom = !!q.from || !!q.to;
  const includes = (at: string, date: string) =>
    custom ? inDateRange(at, q.from, q.to) : date === day;
  const invoices = f.invoices
    .filter((i) => includes(i.created_at, i.date_label))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const pending =
    state?.operations.filter((o) => {
      if (!["DELIVERY", "INSTANT"].includes(o.kind)) return false;
      const result =
        o.kind === "INSTANT"
          ? state.snapshot.instant?.records.find(
              (r) => r.id === o.acknowledgement?.result,
            )?.visit_id
          : o.acknowledgement?.result;
      if (
        result &&
        f.sales.some(
          (s) =>
            s.visit_id === result && f.invoices.some((i) => i.sale_id === s.id),
        )
      )
        return false;
      return custom
        ? inDateRange(o.occurredAt, q.from, q.to)
        : o.status !== "SYNCED" || includes(o.occurredAt, day);
    }) ?? [];
  const filter = (from?: string, to?: string) => {
    const query = new URLSearchParams();
    if (from) query.set("from", from);
    if (to) query.set("to", to);
    window.history.pushState(
      null,
      "",
      `/driver/sales${query.size ? "?" + query : ""}`,
    );
  };
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      {!f.available && (
        <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm">
          <T k="Could not load sales. Reopen the app while online." />
        </p>
      )}
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">
          <T k="Sales History" />
        </h1>
        <p className="text-xs text-muted-foreground">
          {custom ? <T k="Filtered history" /> : <T k="Current business day" />}
        </p>
      </div>
      <details className="rounded-xl border border-border bg-card p-4">
        <summary className="min-h-11 cursor-pointer font-semibold">
          <T k="Filter" />
        </summary>
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => filter()}>
              <T k="Current business day" />
            </Button>
            <Button variant="outline" onClick={() => filter(today, today)}>
              <T k="Today" />
            </Button>
            <Button
              variant="outline"
              onClick={() => filter(shiftDate(today, -6), today)}
            >
              <T k="This week" />
            </Button>
          </div>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              const values = new FormData(e.currentTarget);
              filter(
                String(values.get("from") ?? ""),
                String(values.get("to") ?? ""),
              );
            }}
          >
            <BsDateRange from={q.from} to={q.to} />
            <Button type="submit">
              <T k="Filter history" />
            </Button>
          </form>
        </div>
      </details>
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground">
          <T k="Deliveries" />
        </h2>
        {f.available && !invoices.length && !pending.length && (
          <Card>
            <T k="No sales recorded." />
          </Card>
        )}
        {pending
          .slice()
          .reverse()
          .map((o) => {
            const d = JSON.parse(o.payload) as DeliveryDraft;
            return (
              <HistoryCard
                key={o.id}
                name={
                  data.workspace.customers.find((c) => c.id === d.customer)
                    ?.name ??
                  d.instant?.name ??
                  d.walk_name ??
                  "Walk-in"
                }
                amount={d.total}
                status={
                  o.status === "NEEDS_REVIEW"
                    ? "Needs attention"
                    : o.status === "SYNCED"
                      ? "Synced"
                      : "Saved on phone"
                }
                at={o.occurredAt}
                summary={
                  <>
                    <T
                      k="{0} jars · {1} cartons"
                      values={[
                        d.items.reduce((n, i) => n + i.full_jars, 0),
                        d.items.reduce((n, i) => n + i.cartons, 0),
                      ]}
                    />{" "}
                    ·{" "}
                    <T
                      k={
                        d.status === "CREDIT"
                          ? "Credit"
                          : d.status === "FONEPAY"
                            ? "Fonepay pending"
                            : d.status === "FREE_SUPPLY"
                              ? "Free Supply"
                              : d.status === "RETURN_ONLY"
                                ? "Empty return only"
                                : "Paid"
                      }
                    />
                  </>
                }
              >
                <OfflinePayment status={d.status} />
                {productDeliveries(d.items, data.workspace.products).map(
                  (line) => (
                    <ProductDeliverySummary key={line.product_id} line={line} />
                  ),
                )}
                {o.message && (
                  <p role="alert">
                    <Message value={o.message} />
                  </p>
                )}
                <p>
                  <T k="Amount received" />:{" "}
                  <Value value={npr(d.received ?? "0")} />
                </p>
              </HistoryCard>
            );
          })}
        {invoices.map((i) => {
          const sale = f.sales.find((s) => s.id === i.sale_id);
          const lines = (f.delivery_items ?? []).filter(
            (line) => line.visit_id === sale?.visit_id,
          );
          return (
            <HistoryCard
              key={i.id}
              name={i.customer.name}
              amount={invoiceTotals(i, f).effective}
              status={invoicePaymentStatus(i, f)}
              at={i.created_at}
              summary={
                <T
                  k="{0} jars · {1} cartons"
                  values={[
                    lines.reduce((n, line) => n + line.full_jars, 0),
                    lines.reduce((n, line) => n + line.cartons, 0),
                  ]}
                />
              }
            >
              <p className="font-semibold">
                <T
                  k="Invoice MK-{0} · {1}"
                  values={[i.number.padStart(8, "0"), i.customer.name]}
                />
              </p>
              {lines.map((line) => (
                <ProductDeliverySummary key={line.product_id} line={line} />
              ))}
              <p>
                <T k="Outstanding" />: <Value value={npr(i.outstanding)} />
              </p>
              {f.items.some(
                (s) =>
                  s.sale_id === i.sale_id &&
                  s.supply_classification === "FREE_SUPPLY",
              ) && (
                <p>
                  <T k="Value of Free Supply" />:{" "}
                  <Value value={npr(invoiceFreeValue(i, f))} />
                </p>
              )}
              <p>
                <T k="Synced" />
              </p>
              <Link
                className="inline-flex min-h-11 items-center font-semibold text-primary underline"
                href={`/driver/invoices/${i.id}`}
              >
                <T k="Open invoice" />
              </Link>
            </HistoryCard>
          );
        })}
      </section>
      <details className="rounded-xl border border-border bg-card p-4">
        <summary className="min-h-11 cursor-pointer font-semibold">
          <T k="Collections" />
        </summary>
        <div className="space-y-3">
          {f.payments
            .filter((p) =>
              includes(
                p.created_at,
                data.overview.days.find((d) => d.id === p.business_day_id)
                  ?.date_label ?? nepalDateLabel(new Date(p.created_at)),
              ),
            )
            .map((p) => (
              <HistoryCard
                key={p.id}
                name={p.customer_snapshot.name}
                amount={p.amount}
                status={
                  p.method === "FONEPAY" && p.status === "PENDING"
                    ? "Fonepay pending"
                    : p.status
                }
                at={p.created_at}
              >
                <p>
                  <Message value={p.method} />
                </p>
                <Link
                  className="inline-flex min-h-11 items-center text-primary underline"
                  href={`/driver/payments/${p.id}`}
                >
                  <T
                    k="Receipt MK-P-{0} · {1}"
                    values={[
                      p.number.padStart(8, "0"),
                      p.customer_snapshot.name,
                    ]}
                  />
                </Link>
              </HistoryCard>
            ))}
          {state?.operations
            .filter((o) => o.kind === "PAYMENT" && o.status !== "SYNCED")
            .map((o) => {
              const p = JSON.parse(o.payload);
              return (
                <HistoryCard
                  key={o.id}
                  name={
                    data.workspace.customers.find((c) => c.id === p.customer)
                      ?.name ?? "Customer"
                  }
                  amount={p.amount}
                  status={
                    o.status === "NEEDS_REVIEW"
                      ? "Needs attention"
                      : "Saved on phone"
                  }
                  at={o.occurredAt}
                >
                  <Message value={p.method} />
                </HistoryCard>
              );
            })}
        </div>
      </details>
      <details className="rounded-xl border border-border bg-card p-4">
        <summary className="min-h-11 cursor-pointer font-semibold">
          <T k="Sales and collection totals" />
        </summary>
        <DriverMoney finance={f} day={data.day?.id ?? "no-open-day"} />
      </details>
      <details className="rounded-xl border border-border bg-card p-4">
        <summary className="min-h-11 cursor-pointer font-semibold">
          <T k="Delivery rounds and empty returns" />
        </summary>
        <TripList trips={data.history ?? data.overview.trips} admin={false} />
      </details>
    </div>
  );
}
function OfflinePayment({ status }: { status: DeliveryDraft["status"] }) {
  return (
    <p>
      <T k="Payment Status" />:{" "}
      <T
        k={
          status === "PAID"
            ? "Paid"
            : status === "FONEPAY"
              ? "Fonepay pending"
              : status === "CREDIT"
                ? "Credit"
                : status === "FREE_SUPPLY"
                  ? "Free Supply"
                  : "Empty return only"
        }
      />
    </p>
  );
}
