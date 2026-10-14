"use client";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { ArrowUpRight, Package, Phone, MapPin } from "lucide-react";
import { T, DateValue, Value, Message, useLocale } from "./localization";
import { Input } from "./ui/input";
import { Card } from "./ui/card";
import {
  filterJarCustomers,
  jarQuantity,
  jarSummary,
  oldestJar,
  type AdminJarWorkspace,
  type JarFilters,
} from "@/domain/operations/admin-jars";

export function AdminJarCards({
  workspace,
  children,
}: {
  workspace: AdminJarWorkspace;
  children?: ReactNode;
}) {
  const { t } = useLocale();
  const [filters, setFilters] = useState<JarFilters>({
    search: "",
    type: "",
    driver: "",
    product: "",
    balance: "outstanding",
    sort: "highest",
  });
  const rows = filterJarCustomers(workspace.customers, filters);
  const totals = jarSummary(workspace.customers);
  const summaries = [
    ["Total Unreturned Jars", totals.outstanding],
    ["Customers With Unreturned Jars", totals.customers],
    ["Jars Returned This Month", totals.returned],
    ["Jars Outstanding Over 30 Days", totals.overdue],
  ] as const;
  const selectClass =
    "min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm";
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {summaries.map(([label, value]) => (
          <Card key={label} className="p-5">
            <p className="text-sm font-medium text-muted-foreground">
              <Message value={label} />
            </p>
            <p
              className="mt-3 text-3xl font-bold tabular-nums text-primary"
              data-testid={label}
            >
              <Value value={value} />
            </p>
          </Card>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        <T k="Confirmed totals across all customers. Filters apply to customer cards." />{" "}
        <T k="Returns are counted in the current BS month; audited balance corrections are separate." />{" "}
        <T k="Last confirmed refresh" />:{" "}
        <DateValue value={workspace.snapshot_at} time />
      </p>
      {children}
      <Card className="space-y-4 p-5">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <label className="grid gap-2 text-sm font-medium">
            <T k="Search name or phone" />
            <Input
              type="search"
              value={filters.search}
              onChange={(e) =>
                setFilters({ ...filters, search: e.target.value })
              }
              placeholder={t("Customer name or phone")}
            />
          </label>
          <label className="grid gap-2 text-sm font-medium">
            <T k="Customer type" />
            <select
              className={selectClass}
              value={filters.type}
              onChange={(e) => setFilters({ ...filters, type: e.target.value })}
            >
              <option value="">
                <T k="All customer types" />
              </option>
              <option value="REGULAR">
                <T k="REGULAR" />
              </option>
              <option value="HOUSE">
                <T k="HOUSE" />
              </option>
            </select>
          </label>
          <label className="grid gap-2 text-sm font-medium">
            <T k="Driver" />
            <select
              className={selectClass}
              value={filters.driver}
              onChange={(e) =>
                setFilters({ ...filters, driver: e.target.value })
              }
            >
              <option value="">
                <T k="All drivers" />
              </option>
              {workspace.drivers.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-2 text-sm font-medium">
            <T k="Jar product" />
            <select
              className={selectClass}
              value={filters.product}
              onChange={(e) =>
                setFilters({ ...filters, product: e.target.value })
              }
            >
              <option value="">
                <T k="All jar products" />
              </option>
              {workspace.products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-2 text-sm font-medium">
            <T k="Jar balance" />
            <select
              className={selectClass}
              value={filters.balance}
              onChange={(e) =>
                setFilters({
                  ...filters,
                  balance: e.target.value as JarFilters["balance"],
                })
              }
            >
              <option value="outstanding">
                <T k="Outstanding only" />
              </option>
              <option value="all">
                <T k="All balances" />
              </option>
              <option value="zero">
                <T k="Zero balance only" />
              </option>
            </select>
          </label>
          <label className="grid gap-2 text-sm font-medium">
            <T k="Sort customers" />
            <select
              className={selectClass}
              value={filters.sort}
              onChange={(e) =>
                setFilters({
                  ...filters,
                  sort: e.target.value as JarFilters["sort"],
                })
              }
            >
              <option value="highest">
                <T k="Highest unreturned first" />
              </option>
              <option value="oldest">
                <T k="Oldest outstanding first" />
              </option>
              <option value="name">
                <T k="Customer name" />
              </option>
            </select>
          </label>
        </div>
        {filters.driver && (
          <p className="text-xs text-muted-foreground">
            <T k="Shows customers served by this driver. Balances include confirmed activity from every driver." />
          </p>
        )}
        {filters.product && (
          <p className="text-xs text-muted-foreground">
            <T k="Card quantities and outstanding dates are for the selected jar product." />
          </p>
        )}
      </Card>
      <p className="text-sm text-muted-foreground" role="status">
        <T k="{0} customers shown" values={[rows.length]} />
      </p>
      {!rows.length ? (
        <Card>
          <p className="text-sm text-muted-foreground">
            <T k="No customers match these jar filters." />
          </p>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {rows.map((customer) => {
            const oldest = oldestJar(customer, filters.product);
            return (
              <Link
                key={customer.id}
                href={`/admin/pending-jars?customer=${customer.id}#customer-jar-history`}
                prefetch={false}
                className="group flex min-w-0 flex-col rounded-xl border border-border bg-card p-5 shadow-sm transition-colors hover:border-primary/50 hover:bg-primary/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                aria-label={`${customer.name} · ${t("View History")}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <h2 className="break-words text-lg font-semibold leading-snug">
                    {customer.name}
                  </h2>
                  <span className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-xs font-semibold text-primary">
                    <Message value={customer.supply_type} />
                  </span>
                </div>
                {!customer.is_active && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    <T k="Inactive" />
                  </p>
                )}
                <div className="mt-3 space-y-1.5 text-sm text-muted-foreground">
                  {customer.phone && (
                    <p className="flex items-center gap-2 break-all">
                      <Phone className="size-3.5 shrink-0" aria-hidden="true" />
                      {customer.phone}
                    </p>
                  )}
                  {customer.address && (
                    <p className="flex items-start gap-2 break-words">
                      <MapPin
                        className="mt-0.5 size-3.5 shrink-0"
                        aria-hidden="true"
                      />
                      {customer.address}
                    </p>
                  )}
                  {customer.last_delivery && (
                    <p>
                      <T k="Last jar delivery" />:{" "}
                      <DateValue value={customer.last_delivery} />
                    </p>
                  )}
                </div>
                <div className="mt-5 flex-1" />
                <div className="w-fit rounded-lg border border-primary/15 bg-primary/5 px-4 py-3">
                  <p className="flex items-center gap-2 text-xs font-medium text-primary">
                    <Package className="size-3.5" aria-hidden="true" />
                    <T k="Jars to Return" />
                  </p>
                  <p className="mt-1 text-2xl font-bold tabular-nums text-primary">
                    <T
                      k="{0} Jars"
                      values={[jarQuantity(customer, filters.product)]}
                    />
                  </p>
                </div>
                <div className="mt-4 space-y-1 border-t border-border pt-3 text-xs text-muted-foreground">
                  {oldest && (
                    <p>
                      <T k="Oldest outstanding" />: <DateValue value={oldest} />
                    </p>
                  )}
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p>
                      <T k="Last jar activity" />:{" "}
                      {customer.last_activity ? (
                        <DateValue value={customer.last_activity} />
                      ) : (
                        <T k="No jar activity" />
                      )}
                    </p>
                    <span className="inline-flex items-center gap-1 font-medium text-primary">
                      <T k="View History" />
                      <ArrowUpRight className="size-3.5" aria-hidden="true" />
                    </span>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
