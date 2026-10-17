"use client";
import Link from "next/link";
import { Users, Droplets, Wallet, Warehouse, ArrowUpRight } from "lucide-react";
import type { DriverData } from "./driver-application";
import type { LocalState, CollectionDraft } from "@/domain/offline/types";
import { T, DateValue, Value } from "./localization";
import { Card } from "./ui/card";
import { Button } from "./ui/button";
import { DriverTripCard } from "./driver-trip-card";
import { DriverStockSummary } from "./driver-stock";
import { npr } from "@/domain/finance/money";

export function DriverHomeView({
  data,
  state,
}: {
  data: DriverData;
  state?: LocalState;
}) {
  const w = data.workspace;
  const activity = [
    ...w.visits.map((v) => ({
      id: v.id,
      at: v.offline_occurred_at ?? v.created_at,
      name:
        w.customers.find((c) => c.id === v.customer_id)?.name ??
        (v.walk_in_name || "Walk-in"),
      amount: v.value_snapshot,
      kind: "Delivery",
    })),
    ...data.finance.payments
      .filter((p) => !p.current_invoice_id)
      .map((p) => ({
        id: p.id,
        at: p.created_at,
        name: p.customer_snapshot.name,
        amount: p.amount,
        kind: "Collection",
      })),
    ...(state?.operations
      .filter((o) => o.kind === "PAYMENT" && o.status !== "SYNCED")
      .map((o) => {
        const d = JSON.parse(o.payload) as CollectionDraft;
        return {
          id: o.id,
          at: o.occurredAt,
          name:
            w.customers.find((c) => c.id === d.customer)?.name ?? "Customer",
          amount: d.amount,
          kind: "Collection",
        };
      }) ?? []),
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 3);
  const actions = [
    ["Customers", "/driver/customers", Users],
    ["Pending Jars", "/driver/pending-jars", Droplets],
    ["Collections", "/driver/collections", Wallet],
    ["Return to Warehouse", "/driver/return", Warehouse],
  ] as const;
  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm text-muted-foreground">
          <T k="My Stock" />
        </p>
        <h1 className="text-2xl font-bold">
          <T k="Hello, {0}" values={[data.profile.name.split(" ")[0]]} />
        </h1>
      </div>
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <div className="space-y-5">
          <DriverTripCard data={data} />
          {data.trip && <DriverStockSummary workspace={w} trip={data.trip} />}
          {data.delivering && (
            <Button asChild className="min-h-14 w-full text-base">
              <Link href="/driver/delivery">
                <T k="New Delivery" />
                <ArrowUpRight className="size-5" aria-hidden />
              </Link>
            </Button>
          )}
        </div>
        <div className="space-y-5">
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-muted-foreground">
              <T k="Quick actions" />
            </h2>
            <div className="grid grid-cols-2 gap-3">
              {actions.map(([label, href, Icon]) => (
                <Link
                  key={href}
                  href={href}
                  className="flex min-h-20 items-center gap-2 rounded-xl border border-border bg-card p-3 text-sm font-semibold text-primary hover:bg-muted"
                >
                  <Icon className="size-5 shrink-0" aria-hidden />
                  <T k={label} />
                </Link>
              ))}
            </div>
          </section>
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-muted-foreground">
                <T k="Recent activity" />
              </h2>
              <Link
                href="/driver/sales"
                className="inline-flex min-h-11 items-center text-sm font-semibold text-primary"
              >
                <T k="View all" />
              </Link>
            </div>
            <Card className="divide-y divide-border py-1">
              {!activity.length && (
                <p className="py-4 text-sm text-muted-foreground">
                  <T k="No deliveries or collections yet." />
                </p>
              )}
              {activity.map((a) => (
                <div
                  key={`${a.kind}:${a.id}`}
                  className="flex items-start justify-between gap-3 py-3"
                >
                  <div className="min-w-0">
                    <p className="font-semibold">{a.name}</p>
                    <p className="text-xs text-muted-foreground">
                      <T k={a.kind} /> · <DateValue value={a.at} time />
                    </p>
                  </div>
                  <p className="shrink-0 text-sm font-semibold">
                    <Value value={npr(a.amount)} />
                  </p>
                </div>
              ))}
            </Card>
          </section>
        </div>
      </div>
    </div>
  );
}
