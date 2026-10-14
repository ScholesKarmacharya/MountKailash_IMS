"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { DriverData } from "./driver-application";
import type { LocalState } from "@/domain/offline/types";
import type { Trip, Workspace } from "@/domain/operations/types";
import {
  instantStatus,
  instantTotals,
  instantJarStatus,
  instantPaymentStatus,
  eligibleInstantTrips,
  validateInstant,
  type InstantRecord,
  type InstantWorkspace,
  type InstantHistory,
} from "@/domain/instant";
import { cents, decimal, npr } from "@/domain/finance/money";
import { nepalDateLabel } from "@/domain/business-days/time";
import { inDateRange } from "@/domain/localization/calendar";
import { localStock } from "@/domain/offline/operations";
import {
  T,
  Message,
  DateValue,
  Value,
  LocalizedSelect,
  useLocale,
} from "./localization";
import { Card } from "./ui/card";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Counter, OperationForm } from "./operation-form";
import { AmountInput } from "./finance-payment";
import { BsDatePicker } from "./bs-date-picker";
import { cachedInstantHistory } from "@/domain/offline/instant";

function InstantForm({
  data,
  state,
}: {
  data: DriverData;
  state?: LocalState;
}) {
  const w = data.workspace;
  const products = w.products.filter(
    (p) =>
      p.is_active &&
      w.loads.some((l) => l.trip_id === data.trip?.id && l.product_id === p.id),
  );
  const [product, setProduct] = useState(products[0]?.id ?? ""),
    [quantity, setQuantity] = useState(0),
    [empties, setEmpties] = useState(0);
  const [name, setName] = useState(""),
    [phone, setPhone] = useState(""),
    [location, setLocation] = useState("");
  const [credit, setCredit] = useState(false),
    [received, setReceived] = useState<string | null>(null),
    [reviewed, setReviewed] = useState(""),
    [error, setError] = useState("");
  const [id] = useState(() => crypto.randomUUID()),
    [key] = useState(() => crypto.randomUUID());
  const chosen = products.find((p) => p.id === product),
    jar = chosen?.kind === "FULL_JAR";
  const price = chosen?.default_price ?? "0",
    subtotal = cents(price) * BigInt(quantity);
  const tax =
    data.finance.company?.tax_mode === "EXPLICIT"
      ? (subtotal * cents(data.finance.company.tax_rate) + 5000n) / 10000n
      : 0n;
  const total = decimal(subtotal + tax),
    amount = credit ? "" : (received ?? total);
  const items = [
    {
      product_id: product,
      full_jars: jar ? quantity : 0,
      empty_jars: jar ? empties : 0,
      cartons: jar ? 0 : quantity,
    },
  ];
  const signature = JSON.stringify({
    name,
    phone,
    location,
    items,
    credit,
    amount,
    total,
  });
  const stock = state
    ? localStock(state)
    : w.balances.filter(
        (b) =>
          b.location_id ===
          w.vehicles.find((v) => v.id === data.trip?.vehicle_id)?.location_id,
      );
  const remaining =
    stock.find((b) => b.product_id === product && b.stock_kind === chosen?.kind)
      ?.quantity ?? 0;
  const phoneRequired = credit || (jar && quantity > empties);
  return (
    <Card
      className="min-w-0 space-y-4 [overflow-wrap:anywhere] [&_fieldset]:min-w-0"
      data-testid="instant-form"
    >
      <h2 className="text-xl font-semibold">
        <T k="Quick One-Time Delivery" />
      </h2>
      <p className="text-sm text-muted-foreground">
        <T k="No regular registration needed. Outstanding jars and credit remain tracked." />
      </p>
      <OperationForm
        operation="instant"
        id={id}
        trip={data.trip!.id}
        requestKey={key}
        label="Save Instant Delivery"
        showSubmit={reviewed === signature}
        confirm="Save this reviewed one-time delivery, payment and jar exchange?"
      >
        <label className="grid gap-2 text-sm font-semibold">
          <T k="Customer or Event Name" />
          <Input
            name="event_name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
            required
            autoComplete="name"
          />
        </label>
        <label className="grid gap-2 text-sm font-semibold">
          <T k="Phone Number" />
          <Input
            name="phone"
            type="tel"
            inputMode="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            maxLength={40}
            required={phoneRequired}
            autoComplete="tel"
          />
        </label>
        {phoneRequired && (
          <p className="text-xs text-muted-foreground">
            <T k="A contact name and valid phone number are required for outstanding jars or credit." />
          </p>
        )}
        <label className="grid gap-2 text-sm font-semibold">
          <T k="Delivery Location" />
          <Input
            name="location"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            maxLength={500}
            required
          />
        </label>
        <label className="grid gap-2 text-sm font-semibold">
          <T k="Product" />
          <LocalizedSelect
            aria-label="Product"
            value={product}
            onChange={(e) => {
              setProduct(e.target.value);
              setQuantity(0);
              setEmpties(0);
              setReceived(null);
            }}
            className="min-h-12 rounded-lg border border-input bg-white p-3"
          >
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </LocalizedSelect>
        </label>
        <p className="text-sm">
          <T k="Applicable Price" />: <Value value={npr(price)} /> ·{" "}
          <T k="Remaining stock" />: <Value value={remaining} />
        </p>
        <Counter
          label={jar ? "Jars Delivered" : "Cartons Delivered"}
          value={quantity}
          onChange={setQuantity}
          max={remaining}
        />
        {jar && (
          <Counter
            label="Empty Jars Collected"
            value={empties}
            onChange={setEmpties}
            max={quantity}
          />
        )}
        <fieldset>
          <legend className="mb-2 text-sm font-semibold">
            <T k="Payment Status" />
          </legend>
          <div className="grid grid-cols-2 gap-3">
            {[false, true].map((value) => (
              <Button
                key={String(value)}
                type="button"
                aria-pressed={credit === value}
                variant={credit === value ? "default" : "outline"}
                className="min-h-14"
                onClick={() => {
                  setCredit(value);
                  setReceived(null);
                }}
              >
                <T k={value ? "Credit" : "Paid"} />
              </Button>
            ))}
          </div>
        </fieldset>
        <p className="text-lg font-semibold">
          <T k="Total Amount" />: <Value value={npr(total)} />
        </p>
        {!credit && (
          <AmountInput
            label="Amount collected (NPR)"
            value={amount}
            onChange={setReceived}
            required
          />
        )}
        <input type="hidden" name="notes" value="" />
        <input type="hidden" name="items" value={JSON.stringify(items)} />
        <input
          type="hidden"
          name="payment_status"
          value={credit ? "CREDIT" : "PAID"}
        />
        <input type="hidden" name="received_amount" value={amount} />
        <input type="hidden" name="reviewed_total" value={total} />
        <Button
          type="button"
          variant="outline"
          className="min-h-12 w-full"
          onClick={() => {
            try {
              validateInstant(
                { id, name, phone, location },
                jar ? quantity : 0,
                jar ? empties : 0,
                credit,
              );
              if (!chosen || quantity < 1)
                throw new Error("Enter a delivered quantity for this event.");
              if (quantity > remaining)
                throw new Error("Quantity exceeds remaining stock.");
              if (empties > quantity && jar)
                throw new Error(
                  "Empty returns exceed the locally known jar balance.",
                );
              if (!credit && cents(amount) !== cents(total))
                throw new Error(
                  "Total amount received must equal the payable total.",
                );
              setReviewed(signature);
              setError("");
            } catch (e) {
              setError((e as Error).message);
              setReviewed("");
            }
          }}
        >
          <T k="Review Instant Delivery" />
        </Button>
        {error && (
          <p role="alert" className="text-sm text-red-800">
            <Message value={error} />
          </p>
        )}
        {reviewed === signature && (
          <div className="rounded-lg bg-teal-50 p-3 text-sm" role="status">
            <p className="font-semibold">{name}</p>
            <p>{location}</p>
            <p>
              {chosen?.name} ·{" "}
              <T k={jar ? "Jars Delivered" : "Cartons Delivered"} />:{" "}
              <Value value={quantity} />
            </p>
            {jar && (
              <p>
                <T k="Empty Jars Collected" />: <Value value={empties} />
              </p>
            )}
            <p>
              <T k="Jars to Return" />:{" "}
              <Value value={jar ? quantity - empties : 0} /> ·{" "}
              <T k={credit ? "Credit" : "Paid"} />: <Value value={npr(total)} />
            </p>
          </div>
        )}
      </OperationForm>
    </Card>
  );
}

export function InstantCards({
  workspace,
  admin = false,
  select,
}: {
  workspace: InstantWorkspace;
  admin?: boolean;
  select?: (record: InstantRecord) => void;
}) {
  const { t } = useLocale();
  const [search, setSearch] = useState(""),
    [filter, setFilter] = useState("all"),
    [driver, setDriver] = useState("");
  const [vehicle, setVehicle] = useState("");
  const [from, setFrom] = useState(""),
    [to, setTo] = useState("");
  const today = nepalDateLabel(new Date());
  const records = workspace.records.filter(
    (r) =>
      `${r.event_name} ${r.phone} ${r.location}`
        .toLowerCase()
        .includes(search.toLowerCase()) &&
      (!driver || r.driver_id === driver) &&
      (!vehicle || (r.vehicle_id ?? r.vehicle) === vehicle) &&
      (filter !== "today" ||
        nepalDateLabel(new Date(r.created_at)) === today) &&
      (filter !== "jars" || r.pending > 0) &&
      (filter !== "payments" || cents(r.outstanding) > 0n) &&
      (filter !== "completed" || instantStatus(r) === "Completed") &&
      inDateRange(r.created_at, from || undefined, to || undefined),
  );
  const totals = instantTotals(records),
    drivers = [
      ...new Map(
        workspace.records.map((r) => [r.driver_id, r.driver]),
      ).entries(),
    ];
  const summary = [
    ["Total Instant Deliveries", totals.deliveries],
    [
      "Today's One-Time Deliveries",
      records.filter((r) => nepalDateLabel(new Date(r.created_at)) === today)
        .length,
    ],
    ["Jars Delivered", totals.jars],
    ["Empty Jars Collected", totals.returned],
    ["Jars Pending Return", totals.pending],
    ["Amount Collected", npr(totals.collected)],
    ["Outstanding Credit", npr(totals.outstanding)],
  ] as const;
  return (
    <div className="min-w-0 space-y-4 [overflow-wrap:anywhere]">
      {!workspace.available && (
        <p role="alert">
          <T
            k={
              workspace.unavailable_reason === "cache"
                ? "Refresh this device online to enable Instant Delivery."
                : "Instant Delivery requires a database update. Contact the admin."
            }
          />
        </p>
      )}
      {admin && workspace.available && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {summary.map(([label, value]) => (
            <Card key={label} className="p-5">
              <p className="text-sm font-medium text-muted-foreground">
                <T k={label} />
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
      )}
      <label className="grid gap-2 text-sm font-semibold">
        <T k="Search events or phone" />
        <Input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-2 text-sm">
          <T k="Delivery status" />
          <LocalizedSelect
            aria-label="Delivery status"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="min-h-12 rounded-lg border border-input bg-white p-3"
          >
            {[
              ["all", "All deliveries"],
              ["today", "Today"],
              ["jars", "Pending Jar Return"],
              ["payments", "Pending Payment"],
              ["completed", "Completed"],
            ].map(([v, label]) => (
              <option key={v} value={v}>
                {t(label!)}
              </option>
            ))}
          </LocalizedSelect>
        </label>
        {admin && (
          <label className="grid gap-2 text-sm">
            <T k="Driver" />
            <LocalizedSelect
              aria-label="Driver"
              value={driver}
              onChange={(e) => setDriver(e.target.value)}
              className="min-h-12 rounded-lg border border-input bg-white p-3"
            >
              <option value="">
                <T k="All drivers" />
              </option>
              {drivers.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </LocalizedSelect>
          </label>
        )}
        {admin && (
          <label className="grid gap-2 text-sm">
            <T k="Vehicle" />
            <LocalizedSelect
              aria-label="Vehicle"
              value={vehicle}
              onChange={(e) => setVehicle(e.target.value)}
              className="min-h-12 rounded-lg border border-input bg-white p-3"
            >
              <option value="">
                <T k="All vehicles" />
              </option>
              {[
                ...new Map(
                  workspace.records.map((r) => [
                    r.vehicle_id ?? r.vehicle,
                    r.vehicle,
                  ]),
                ).entries(),
              ].map(([id, plate]) => (
                <option key={id} value={id}>
                  {plate}
                </option>
              ))}
            </LocalizedSelect>
          </label>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <p className="text-sm font-medium">
            <T k="From BS date" />
          </p>
          <BsDatePicker label="From BS date" value={from} onChange={setFrom} />
        </div>
        <div className="space-y-2">
          <p className="text-sm font-medium">
            <T k="To BS date" />
          </p>
          <BsDatePicker label="To BS date" value={to} onChange={setTo} />
        </div>
      </div>
      {(from || to) && (
        <Button
          variant="ghost"
          onClick={() => {
            setFrom("");
            setTo("");
          }}
        >
          <T k="Clear date filters" />
        </Button>
      )}
      {workspace.available && !records.length && (
        <Card className="p-6 text-center text-muted-foreground">
          <T k="No Instant Deliveries match these filters." />
        </Card>
      )}
      <div className="grid gap-3 lg:grid-cols-2">
        {records.map((r) => (
          <Card
            key={r.id}
            className="relative min-w-0 space-y-4"
            data-testid="instant-card"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <h2 className="min-w-0 max-w-full text-lg font-semibold [overflow-wrap:anywhere]">
                {r.event_name}
              </h2>
              <span className="rounded-full bg-teal-50 px-2 py-1 text-xs font-semibold text-teal-900">
                <Message value={instantStatus(r)} />
              </span>
            </div>
            {r.phone && (
              <p className="text-sm">
                <T k="Contact Number" />: {r.phone}
              </p>
            )}
            <p className="text-sm">
              <T k="Delivery Location" />: {r.location}
            </p>
            <p className="text-sm text-muted-foreground">
              <DateValue value={r.created_at} time />
            </p>
            <div className="grid grid-cols-2 gap-3 border-y border-border py-3 text-sm">
              <p>
                <T k="Driver" />
                <strong className="block font-semibold">{r.driver}</strong>
              </p>
              <p>
                <T k="Vehicle" />
                <strong className="block font-semibold">{r.vehicle}</strong>
              </p>
              <p className="col-span-2">
                <T k="Trip #{0}" values={[r.trip_number]} />
              </p>
            </div>
            {r.items.map((i) => (
              <p className="text-sm" key={i.product_id}>
                {i.name} ·{" "}
                <T k={i.full_jars ? "Jars Delivered" : "Cartons Delivered"} />:{" "}
                <Value value={i.full_jars || i.cartons} />
              </p>
            ))}
            <div className="grid grid-cols-2 gap-3 text-sm">
              <p>
                <T k="Jars Delivered" />{" "}
                <strong className="block">
                  <Value value={r.items.reduce((n, i) => n + i.full_jars, 0)} />
                </strong>
              </p>
              <p>
                <T k="Empty Jars Collected" />{" "}
                <strong className="block">
                  <Value value={r.returned} />
                </strong>
              </p>
            </div>
            <div
              className="w-fit min-w-32 rounded-lg border border-primary/20 bg-teal-50 p-3"
              data-testid="instant-pending-jars"
            >
              <p className="text-sm font-medium text-primary">
                <T k="Jars to Return" />
              </p>
              <strong className="block text-3xl tabular-nums text-primary">
                <Value value={r.pending} />
              </strong>
            </div>
            <p className="text-sm">
              <T k="Jar Status" />: <Message value={instantJarStatus(r)} />
            </p>
            <p className="text-sm">
              <T k="Payment Status" />:{" "}
              <Message value={instantPaymentStatus(r)} />
            </p>
            <p className="text-sm">
              <T k="Amount Collected" />: <Value value={npr(r.collected)} /> ·{" "}
              <T k="Outstanding Payments" />:{" "}
              <Value value={npr(r.outstanding)} />
            </p>
            {select ? (
              <Button
                variant="outline"
                className="min-h-12 w-full after:absolute after:inset-0 after:content-['']"
                onClick={() => select(r)}
              >
                <T k="Open Instant Delivery" />
              </Button>
            ) : (
              <Button asChild variant="outline" className="min-h-12 w-full">
                <Link
                  className="after:absolute after:inset-0 after:content-['']"
                  href={`/admin/instant-deliveries/${r.id}`}
                >
                  <T k="Open Instant Delivery" />
                </Link>
              </Button>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}

export function InstantHistoryView({
  history,
  admin = false,
}: {
  history: InstantHistory;
  admin?: boolean;
}) {
  const r = history.record;
  return (
    <div className="space-y-4 break-words" data-testid="instant-history">
      <Card className="space-y-3">
        <h2 className="text-xl font-bold">{r.event_name}</h2>
        <p>{[r.phone, r.location].filter(Boolean).join(" · ")}</p>
        <p>
          <Message value={instantStatus(r)} /> ·{" "}
          <DateValue value={r.created_at} time />
        </p>
        <p>
          {r.driver} · {r.vehicle} ·{" "}
          <T k="Trip #{0}" values={[r.trip_number]} />
        </p>
        {r.items.map((i) => (
          <p key={i.product_id}>
            {i.name} · <T k="Jars Delivered" />: <Value value={i.full_jars} /> ·{" "}
            <T k="Cartons" />: <Value value={i.cartons} /> ·{" "}
            <T k="Applicable Price" />:{" "}
            <Value value={npr(i.unit_price_snapshot)} />
          </p>
        ))}
        <p>
          <T k="Jars to Return" />: <Value value={r.pending} /> ·{" "}
          <T k="Empty Jars Collected" />: <Value value={r.returned} />
        </p>
        <p>
          <T k="Outstanding Payments" />: <Value value={npr(r.outstanding)} />
        </p>
        <p>
          <T k="Jar Status" />: <Message value={instantJarStatus(r)} /> ·{" "}
          <T k="Payment Status" />: <Message value={instantPaymentStatus(r)} />
        </p>
        {r.notes && <p className="break-words">{r.notes}</p>}
        {r.invoice_id && (admin || r.documents_allowed !== false) && (
          <Link
            className="inline-flex min-h-11 items-center text-primary underline"
            href={`/${admin ? "admin" : "driver"}/invoices/${r.invoice_id}`}
          >
            <T k="View invoice" />
          </Link>
        )}
      </Card>
      <Card className="space-y-3">
        <h2 className="font-semibold">
          <T k="Customer jar ledger" />
        </h2>
        {!history.jars.length && (
          <p>
            <T k="No jar movements." />
          </p>
        )}
        {history.jars.map((j) => (
          <div className="border-b border-border py-2 text-sm" key={j.id}>
            <p>
              {j.product} · <Value value={j.delta} /> · <T k="Balance" />:{" "}
              <Value value={j.balance} />
            </p>
            <p>
              <Message value={j.reason} /> · <DateValue value={j.at} time />
            </p>
            <p>
              {j.driver} {j.trip && <T k="Trip #{0}" values={[j.trip]} />}
            </p>
          </div>
        ))}
      </Card>
      <Card className="space-y-3">
        <h2 className="font-semibold">
          <T k="Payment history" />
        </h2>
        {!history.payments.length && (
          <p>
            <T k="No payments recorded." />
          </p>
        )}
        {history.payments.map((p) => (
          <div className="border-b border-border py-2 text-sm" key={p.id}>
            <p>
              <Value value={npr(p.amount)} /> ·{" "}
              <Message value={p.method === "CASH" ? "Cash" : "Fonepay"} /> ·{" "}
              <Message value={p.status} />
            </p>
            <DateValue value={p.at} time />
            {(admin || r.documents_allowed !== false) &&
              !["Saved on Device", "Needs Review"].includes(p.status) && (
                <Link
                  className="ml-3 inline-flex min-h-11 items-center text-primary underline"
                  href={`/${admin ? "admin" : "driver"}/payments/${p.id}`}
                >
                  <T k="View receipt" />
                </Link>
              )}
          </div>
        ))}
      </Card>
      {!!history.adjustments.length && (
        <Card className="space-y-3">
          <h2 className="font-semibold">
            <T k="Invoice adjustments" />
          </h2>
          {history.adjustments.map((a, i) => (
            <p key={i}>
              {a.reason} · <DateValue value={a.created_at} time /> ·{" "}
              <Value
                value={npr(
                  decimal(cents(a.subtotal_delta) + cents(a.tax_delta)),
                )}
              />
            </p>
          ))}
        </Card>
      )}
    </div>
  );
}

function FollowUp({
  record: r,
  trip,
  workspace,
}: {
  record: InstantRecord;
  trip: Trip;
  workspace: Workspace;
}) {
  const [empties, setEmpties] = useState<Record<string, number>>({}),
    [amount, setAmount] = useState("");
  const [returnKey] = useState(() => crypto.randomUUID()),
    [paymentKey] = useState(() => crypto.randomUUID());
  const products = r.items.filter(
    (i) =>
      i.full_jars > 0 &&
      workspace.loads.some(
        (l) => l.trip_id === trip.id && l.product_id === i.product_id,
      ),
  );
  const items = products
    .map((i) => ({
      product_id: i.product_id,
      full_jars: 0,
      cartons: 0,
      empty_jars: empties[i.product_id] ?? 0,
    }))
    .filter((i) => i.empty_jars > 0);
  let collect = false;
  try {
    collect = cents(amount) > 0n && cents(amount) <= cents(r.available);
  } catch {
    /* editable amount */
  }
  return (
    <div className="space-y-4">
      {r.pending > 0 && (
        <Card className="space-y-3">
          <h2 className="font-semibold">
            <T k="Collect Empty Jars" />
          </h2>
          {!products.length && (
            <p>
              <T k="The active trip must include this jar product before collecting empties." />
            </p>
          )}
          <OperationForm
            operation="driver-visit"
            trip={trip.id}
            requestKey={returnKey}
            label="Collect Empty Jars"
            showSubmit={items.length > 0}
            confirm="Record this empty jar collection without creating a new sale?"
          >
            {products.map((i) => (
              <Counter
                key={i.product_id}
                label={`${i.name} · Empty Jars Collected`}
                value={empties[i.product_id] ?? 0}
                max={i.pending}
                onChange={(n) => setEmpties({ ...empties, [i.product_id]: n })}
              />
            ))}
            <input type="hidden" name="customer" value={r.customer_id} />
            <input type="hidden" name="items" value={JSON.stringify(items)} />
            <input type="hidden" name="payment_status" value="RETURN_ONLY" />
            <input type="hidden" name="received_amount" value="" />
            <input type="hidden" name="walk_name" value="" />
            <input type="hidden" name="walk_phone" value="" />
            <input
              type="hidden"
              name="notes"
              value="Instant Delivery empty jar collection"
            />
            <input type="hidden" name="reviewed_total" value="0.00" />
          </OperationForm>
        </Card>
      )}
      {cents(r.outstanding) > 0n && (
        <Card className="space-y-3">
          <h2 className="font-semibold">
            <T k="Collect outstanding credit" />
          </h2>
          {!r.invoice_id || cents(r.available) <= 0n ? (
            <p>
              <T k="Synchronize this invoice before collecting payment; pending payments must be verified first." />
            </p>
          ) : (
            <OperationForm
              operation="finance:PAYMENT"
              trip={trip.id}
              requestKey={paymentKey}
              label="Collect outstanding credit"
              showSubmit={collect}
              confirm="Record this amount against the existing invoice without creating a new sale?"
            >
              <AmountInput
                label="Credit amount received (NPR)"
                value={amount}
                onChange={setAmount}
                required
              />
              <input type="hidden" name="customer" value={r.customer_id} />
              <input
                type="hidden"
                name="payment_data"
                value={JSON.stringify({
                  method: "CASH",
                  amount,
                  reference: "",
                  allocations: [{ invoice_id: r.invoice_id, amount }],
                  deposit_amount: "0",
                })}
              />
            </OperationForm>
          )}
        </Card>
      )}
    </div>
  );
}

function InstantTripChooser({ trips }: { trips: Trip[] }) {
  return (
    <Card className="space-y-3" data-testid="instant-trip-chooser">
      <h2 className="font-semibold">
        <T k="Choose your active delivery trip" />
      </h2>
      {trips.map((trip) => (
        <Button
          key={trip.id}
          asChild
          variant="outline"
          className="min-h-12 w-full"
        >
          <Link href={`/driver/instant-delivery?trip=${trip.id}`}>
            <T k="Trip #{0}" values={[trip.trip_number]} /> ·{" "}
            {trip.plate_number}
          </Link>
        </Button>
      ))}
    </Card>
  );
}

export function InstantDriver({
  data,
  state,
  online,
}: {
  data: DriverData;
  state?: LocalState;
  online: boolean;
}) {
  const [selected, setSelected] = useState<string>(),
    [history, setHistory] = useState<InstantHistory>(),
    [error, setError] = useState("");
  const [historyReload, setHistoryReload] = useState(0);
  const back = useRef<HTMLButtonElement>(null);
  const records = data.instant ?? { available: false, records: [] },
    record = records.records.find((r) => r.id === selected);
  const eligible =
    data.eligibleTrips ?? eligibleInstantTrips(data.workspace, data.profile.id);
  const active =
    data.delivering &&
    !!data.trip &&
    eligible.some((t) => t.id === data.trip!.id) &&
    !data.tripChoiceRequired;
  useEffect(() => {
    if (selected) back.current?.focus();
  }, [selected]);
  useEffect(() => {
    if (!selected) return;
    if (!online || record?.device) return;
    const abort = new AbortController();
    queueMicrotask(() => setError(""));
    void fetch(`/api/instant-deliveries/${selected}`, {
      cache: "no-store",
      signal: abort.signal,
    })
      .then(async (r) => {
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then(setHistory)
      .catch(() => {
        if (!abort.signal.aborted)
          setError(
            "Instant delivery history could not be loaded. Please retry.",
          );
      });
    return () => abort.abort();
  }, [
    selected,
    online,
    record?.pending,
    record?.outstanding,
    record?.returned,
    record?.device,
    historyReload,
  ]);
  const shownHistory =
    state && (!online || record?.device) && record
      ? cachedInstantHistory(state, record)
      : history;
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">
        <T k="Instant Delivery" />
      </h1>
      {!record && (
        <Link
          href="/driver/home"
          className="inline-flex min-h-11 items-center text-primary underline"
        >
          <T k="Back to My Stock" />
        </Link>
      )}
      {selected && record ? (
        <>
          <Button
            ref={back}
            variant="outline"
            onClick={() => {
              setSelected(undefined);
              setHistory(undefined);
            }}
          >
            <T k="Back to Instant Deliveries" />
          </Button>
          {error && (
            <div className="space-y-2" role="alert">
              <p>
                <T k={error} />
              </p>
              <Button
                variant="outline"
                onClick={() => setHistoryReload((n) => n + 1)}
              >
                <T k="Retry" />
              </Button>
            </div>
          )}
          {!online && (
            <p className="text-sm text-muted-foreground">
              <T k="Cached history and device records. Reconnect for complete transaction history." />
            </p>
          )}
          {shownHistory?.record.id === selected ? (
            <InstantHistoryView history={{ ...shownHistory, record }} />
          ) : (
            <p role="status">
              <T k="Loading transaction history…" />
            </p>
          )}
          {active && data.trip && (
            <FollowUp
              key={`${record.id}:${record.pending}:${record.outstanding}`}
              record={record}
              trip={data.trip}
              workspace={data.workspace}
            />
          )}
          {!active && data.tripChoiceRequired ? (
            <InstantTripChooser trips={eligible} />
          ) : (
            !active && (
              <p>
                <T k="No active delivery trip. Please contact the warehouse." />
              </p>
            )
          )}
        </>
      ) : (
        <>
          {records.available && data.tripChoiceRequired ? (
            <InstantTripChooser trips={eligible} />
          ) : active && records.available ? (
            <InstantForm data={data} state={state} />
          ) : records.available ? (
            <p>
              <T k="No active delivery trip. Please contact the warehouse." />
            </p>
          ) : null}
          <h2 className="text-xl font-semibold">
            <T k="Instant Delivery History" />
          </h2>
          <InstantCards
            workspace={records}
            select={(r) => {
              setSelected(r.id);
              setHistory(undefined);
            }}
          />
        </>
      )}
    </div>
  );
}
