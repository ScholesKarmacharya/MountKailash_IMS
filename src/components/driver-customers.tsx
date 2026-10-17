"use client";
import { useState } from "react";
import Link from "next/link";
import { Plus, ChevronRight, ArrowLeft } from "lucide-react";
import type { Customer, Trip, Workspace } from "@/domain/operations/types";
import type { FinanceWorkspace } from "@/domain/finance/types";
import type { LocalState } from "@/domain/offline/types";
import { cachedCredit, customerEstimate } from "@/domain/offline/operations";
import { npr, sum } from "@/domain/finance/money";
import { T, Value } from "./localization";
import { DeliveryCustomerForm } from "./delivery-customers";
import { useDriverRuntime } from "./driver-runtime-context";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Card } from "./ui/card";

export function DriverCustomers({
  workspace: w,
  finance,
  state,
  trip,
}: {
  workspace: Workspace;
  finance?: FinanceWorkspace;
  state?: LocalState;
  trip?: Trip;
}) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string>();
  const [editor, setEditor] = useState<Customer | "new" | null>(null);
  const runtime = useDriverRuntime();
  const customers = w.customers.filter(
    (c) =>
      c.is_active &&
      !c.is_one_time &&
      `${c.name} ${c.shop_name} ${c.phone} ${c.address}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const detail = w.customers.find((c) => c.id === selected);
  const balance = (id: string) =>
    sum(
      (state
        ? cachedCredit(state, id)
        : (finance?.credit.filter((i) => i.customer_id === id) ?? [])
      ).map((i) => i.outstanding),
    );
  const jars = (id: string) =>
    state
      ? w.products
          .filter((p) => p.kind === "FULL_JAR")
          .reduce((n, p) => n + customerEstimate(state, id, p.id).estimated, 0)
      : w.custody
          .filter((c) => c.customer_id === id)
          .reduce((n, c) => n + c.quantity, 0);
  const back = (
    <Button
      variant="ghost"
      onClick={() => {
        setSelected(undefined);
        setEditor(null);
      }}
    >
      <ArrowLeft className="size-4" aria-hidden />
      <T k="Back to customers" />
    </Button>
  );
  if (editor && trip)
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        {back}
        <DeliveryCustomerForm
          key={editor === "new" ? "new" : editor.id}
          trip={trip.id}
          customer={editor === "new" ? undefined : editor}
          detailsEnabled={w.customer_details}
          onCancel={() => setEditor(null)}
          onSaved={() => {
            setEditor(null);
            void runtime?.refresh();
          }}
        />
      </div>
    );
  if (detail)
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        {back}
        <Card className="space-y-4">
          <h1 className="text-2xl font-bold">{detail.name}</h1>
          {detail.shop_name && <p>{detail.shop_name}</p>}
          {detail.phone && (
            <a
              className="inline-flex min-h-11 items-center text-primary underline"
              href={`tel:${detail.phone.replace(/[^+0-9]/g, "")}`}
            >
              {detail.phone}
            </a>
          )}
          {detail.address && (
            <p className="text-sm text-muted-foreground">{detail.address}</p>
          )}
          <div className="grid grid-cols-2 gap-3 rounded-xl bg-muted p-4">
            <div>
              <p className="text-xs text-muted-foreground">
                <T k="Outstanding Credit" />
              </p>
              <p className="font-semibold">
                <Value value={npr(balance(detail.id))} />
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">
                <T k="Pending Jars" />
              </p>
              <p className="font-semibold">
                <Value value={jars(detail.id)} />
              </p>
            </div>
          </div>
          {trip && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Button asChild className="min-h-14">
                <Link href={`/driver/delivery?customer=${detail.id}`}>
                  <T k="New Delivery" />
                </Link>
              </Button>
              <Button asChild variant="outline" className="min-h-14">
                <Link href={`/driver/collections?customer=${detail.id}`}>
                  <T k="Collect Credit" />
                </Link>
              </Button>
              <Button variant="outline" onClick={() => setEditor(detail)}>
                <T k="Edit contact" />
              </Button>
            </div>
          )}
          <Link
            className="inline-flex min-h-11 items-center font-semibold text-primary underline"
            href={`/driver/pending-jars?customer=${detail.id}`}
          >
            <T k="Pending jars" />
          </Link>
        </Card>
      </div>
    );
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">
          <T k="Customers" />
        </h1>
        {trip && (
          <Button onClick={() => setEditor("new")}>
            <Plus className="size-4" aria-hidden />
            <T k="Add Customer" />
          </Button>
        )}
      </div>
      <label className="grid gap-2 text-sm font-semibold">
        <T k="Search customers" />
        <Input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          autoComplete="off"
        />
      </label>
      {!trip && (
        <p className="text-sm text-muted-foreground">
          <T k="Start your trip to add customers or collect credit." />
        </p>
      )}
      {!customers.length && (
        <Card>
          <T k="No matching active customers." />
        </Card>
      )}
      <ul className="grid items-start gap-3 sm:grid-cols-2">
        {customers.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              onClick={() => setSelected(c.id)}
              className="flex min-h-24 w-full items-center justify-between gap-3 rounded-xl border border-border bg-card p-4 text-left hover:bg-muted"
              data-testid={`customer-row-${c.id}`}
            >
              <span className="min-w-0">
                <span className="block font-semibold">{c.name}</span>
                {c.phone && (
                  <span className="mt-1 block text-sm text-muted-foreground">
                    {c.phone}
                  </span>
                )}
                <span className="mt-1 block text-xs text-muted-foreground">
                  <T k="Outstanding" />: <Value value={npr(balance(c.id))} /> ·{" "}
                  <T k="Jars" />: <Value value={jars(c.id)} />
                </span>
              </span>
              <ChevronRight
                className="size-5 shrink-0 text-primary"
                aria-hidden
              />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
