"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Count, Trip, Workspace } from "@/domain/operations/types";
import { moneyTotal, vehicleCounts } from "@/domain/operations/types";
import { stockLabels } from "@/domain/inventory/validation";
import { OperationForm, Counter, Field, Select } from "./operation-form";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
export function CreateTripForm({
  workspace: w,
  requestKey,
  id,
}: {
  workspace: Workspace;
  requestKey: string;
  id: string;
}) {
  const open = w.days.find((d) => d.status === "OPEN");
  const usedDrivers = new Set(
    w.trips.filter((t) => t.status !== "CLOSED").map((t) => t.driver_id),
  );
  const usedVehicles = new Set(
    w.trips.filter((t) => t.status !== "CLOSED").map((t) => t.vehicle_id),
  );
  if (!open)
    return (
      <p>Open a business day in warehouse inventory before assigning a trip.</p>
    );
  return (
    <OperationForm
      operation="create"
      requestKey={requestKey}
      id={id}
      label="Create draft trip"
      resultHref="/admin/trips"
    >
      <input type="hidden" name="day" value={open.id} />
      <p className="text-sm">
        Business day: <strong>{open.date_label}</strong>
      </p>
      <Select name="driver" label="Driver">
        <option value="">Choose available driver</option>
        {w.drivers
          .filter((d) => d.is_active && !usedDrivers.has(d.id))
          .map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
      </Select>
      <Select name="vehicle" label="Vehicle">
        <option value="">Choose available vehicle</option>
        {w.vehicles
          .filter((v) => v.is_active && !usedVehicles.has(v.id))
          .map((v) => (
            <option key={v.id} value={v.id}>
              {v.plate_number}
            </option>
          ))}
      </Select>
      <fieldset className="max-h-64 space-y-3 overflow-auto rounded-lg border border-border p-4">
        <legend className="text-sm font-semibold">Assigned customers</legend>
        {w.customers
          .filter((c) => c.is_active)
          .map((c) => (
            <label key={c.id} className="flex min-h-12 items-center gap-3">
              <input
                type="checkbox"
                name="customers"
                value={c.id}
                className="size-5"
              />
              {c.name} {c.shop_name && `· ${c.shop_name}`}
            </label>
          ))}
        {!w.customers.some((c) => c.is_active) && (
          <p className="text-sm text-muted-foreground">
            No registered customers. Create them in the customer directory, or
            record walk-in exchanges.
          </p>
        )}
      </fieldset>
      <Field name="notes" label="Trip notes" />
    </OperationForm>
  );
}
export function LoadTripForm({
  workspace: w,
  trip,
  requestKey,
}: {
  workspace: Workspace;
  trip: Trip;
  requestKey: string;
}) {
  const products = w.products.filter((p) => p.is_active);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [assigned, setAssigned] = useState<Record<string, boolean>>({});
  const warehouse = w.locations.find((l) => l.code === "MAIN")?.id;
  const selected = products
    .filter((p) => assigned[p.id])
    .map((p) => ({
      product_id: p.id,
      stock_kind: p.kind,
      quantity: quantities[p.id] ?? 0,
    }));
  return (
    <OperationForm
      operation="load"
      trip={trip.id}
      requestKey={requestKey}
      label="Confirm warehouse loading"
      confirm={`Load ${selected.map((i) => `${i.quantity} ${products.find((p) => p.id === i.product_id)?.name}`).join(", ")} onto ${trip.plate_number}?`}
    >
      <p className="text-sm text-muted-foreground">
        Choose products and quantities. A jar product can be assigned with zero
        full jars to permit empty collection; at least one load quantity must be
        positive.
      </p>
      <input type="hidden" name="items" value={JSON.stringify(selected)} />
      {products.map((p) => {
        const available =
          w.balances.find(
            (b) =>
              b.location_id === warehouse &&
              b.product_id === p.id &&
              b.stock_kind === p.kind,
          )?.quantity ?? 0;
        return (
          <div
            key={p.id}
            className="space-y-3 rounded-xl border border-border p-4"
          >
            <label className="flex min-h-12 items-center gap-3 font-semibold">
              <input
                type="checkbox"
                checked={assigned[p.id] ?? false}
                onChange={(e) =>
                  setAssigned({ ...assigned, [p.id]: e.target.checked })
                }
                className="size-5"
              />
              {p.name}
            </label>
            <p className="text-sm">Warehouse available: {available}</p>
            {assigned[p.id] && (
              <Counter
                label={`${p.name} load`}
                value={quantities[p.id] ?? 0}
                max={available}
                onChange={(value) =>
                  setQuantities({ ...quantities, [p.id]: value })
                }
              />
            )}
          </div>
        );
      })}
    </OperationForm>
  );
}
export function DeliveryForm({
  workspace: w,
  trip,
  requestKey,
}: {
  workspace: Workspace;
  trip: Trip;
  requestKey: string;
}) {
  const [search, setSearch] = useState(""),
    [customer, setCustomer] = useState(""),
    [walk, setWalk] = useState(false),
    [walkName, setWalkName] = useState(""),
    [phone, setPhone] = useState("");
  const [payment, setPayment] = useState("CASH"),
    [amount, setAmount] = useState(""),
    [reference, setReference] = useState(""),
    [notes, setNotes] = useState(""),
    [review, setReview] = useState(false);
  const [quantities, setQuantities] = useState<
    Record<string, { full_jars: number; empty_jars: number; cartons: number }>
  >({});
  const counts = vehicleCounts(w, trip);
  const products = w.products.filter((p) =>
    w.loads.some((l) => l.product_id === p.id),
  );
  const quantity = (id: string) =>
    quantities[id] ?? { full_jars: 0, empty_jars: 0, cartons: 0 };
  const update = (
    id: string,
    field: "full_jars" | "empty_jars" | "cartons",
    value: number,
  ) => {
    setQuantities({ ...quantities, [id]: { ...quantity(id), [field]: value } });
    setReview(false);
  };
  const items = products
    .map((p) => ({ product_id: p.id, ...quantity(p.id) }))
    .filter((i) => i.full_jars + i.empty_jars + i.cartons > 0);
  const total = moneyTotal(
    products.map((p) => ({
      price: p.default_price,
      quantity: quantity(p.id).full_jars + quantity(p.id).cartons,
    })),
  );
  const customers = w.customers.filter(
    (c) =>
      c.is_active &&
      `${c.name} ${c.shop_name} ${c.phone} ${c.address}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const selected = w.customers.find((c) => c.id === customer);
  const walkProblem =
    walk &&
    (payment === "UNPAID" ||
      payment === "PARTIAL" ||
      items.some((i) => i.full_jars !== i.empty_jars));
  const custodyProblem =
    !walk &&
    items.some(
      (i) =>
        i.empty_jars >
        (w.custody.find(
          (c) => c.customer_id === customer && c.product_id === i.product_id,
        )?.quantity ?? 0) +
          i.full_jars,
    );
  const eligible =
    items.length > 0 &&
    (walk ? !!walkName.trim() : !!customer) &&
    !walkProblem &&
    !custodyProblem;
  const router = useRouter();
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Remaining stock is checked again when saving.
        </p>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setReview(false);
            router.refresh();
          }}
        >
          Refresh stock
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button
          type="button"
          variant={walk ? "outline" : "default"}
          onClick={() => {
            setWalk(false);
            setReview(false);
          }}
        >
          Registered
        </Button>
        <Button
          type="button"
          variant={walk ? "default" : "outline"}
          onClick={() => {
            setWalk(true);
            setReview(false);
          }}
        >
          Walk-in
        </Button>
      </div>
      <OperationForm
        operation="visit"
        trip={trip.id}
        requestKey={requestKey}
        showSubmit={review}
        label="Save confirmed delivery"
        confirm={`Save ${walk ? walkName : selected?.name}: ${items.map((i) => `${i.full_jars} full, ${i.empty_jars} empty, ${i.cartons} cartons`).join("; ")}? Payment remains unverified.`}
      >
        <input type="hidden" name="customer" value={walk ? "" : customer} />
        <input type="hidden" name="items" value={JSON.stringify(items)} />
        <input type="hidden" name="walk_name" value={walk ? walkName : ""} />
        <input type="hidden" name="walk_phone" value={walk ? phone : ""} />
        <input type="hidden" name="payment" value={payment} />
        <input
          type="hidden"
          name="amount"
          value={payment === "UNPAID" ? "" : amount}
        />
        <input type="hidden" name="reference" value={reference} />
        <input type="hidden" name="notes" value={notes} />
        {!review ? (
          <>
            {walk ? (
              <label className="grid gap-2 text-sm font-semibold">
                Walk-in name
                <Input
                  value={walkName}
                  maxLength={120}
                  required
                  onChange={(e) => setWalkName(e.target.value)}
                />
              </label>
            ) : (
              <div className="space-y-3">
                <label className="grid gap-2 text-sm font-semibold">
                  Search assigned customers
                  <Input
                    type="search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </label>
                <div className="max-h-64 space-y-2 overflow-auto">
                  {customers.map((c) => (
                    <Button
                      key={c.id}
                      type="button"
                      variant={customer === c.id ? "default" : "outline"}
                      className="min-h-14 w-full justify-start whitespace-normal text-left"
                      onClick={() => setCustomer(c.id)}
                    >
                      {c.name}
                      {c.shop_name && ` · ${c.shop_name}`}
                      <span className="ml-auto text-xs">{c.phone}</span>
                    </Button>
                  ))}
                  {customers.length === 0 && (
                    <p className="text-sm">
                      No matching route customers. Ask admin to assign this
                      customer, or use walk-in for an immediate exchange.
                    </p>
                  )}
                </div>
                {selected && (
                  <p className="text-sm font-semibold">
                    Selected: {selected.name}
                  </p>
                )}
              </div>
            )}
            {walk && (
              <label className="grid gap-2 text-sm font-semibold">
                Walk-in phone (optional)
                <Input
                  value={phone}
                  maxLength={40}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </label>
            )}
            {products.map((p) => {
              const q = quantity(p.id);
              const available = (kind: string) =>
                counts.find(
                  (c) => c.product_id === p.id && c.stock_kind === kind,
                )?.quantity ?? 0;
              return (
                <Card key={p.id} className="space-y-5 p-4">
                  <h3 className="font-semibold">{p.name}</h3>
                  {p.kind === "FULL_JAR" ? (
                    <>
                      <p className="text-sm">
                        Vehicle: <strong>{available("FULL_JAR")} full</strong> ·{" "}
                        {available("EMPTY_JAR")} empty
                      </p>
                      <Counter
                        label="Full jars delivered"
                        value={q.full_jars}
                        max={p.is_active ? available("FULL_JAR") : 0}
                        onChange={(n) => update(p.id, "full_jars", n)}
                      />
                      <Counter
                        label="Empty jars collected"
                        value={q.empty_jars}
                        onChange={(n) => update(p.id, "empty_jars", n)}
                      />
                      {selected && !walk && (
                        <p className="text-xs text-muted-foreground">
                          Customer holds{" "}
                          {w.custody.find(
                            (c) =>
                              c.customer_id === customer &&
                              c.product_id === p.id,
                          )?.quantity ?? 0}{" "}
                          jars before this visit.
                        </p>
                      )}
                    </>
                  ) : (
                    <>
                      <p className="text-sm">
                        Vehicle:{" "}
                        <strong>{available("BOTTLE_CARTON")} cartons</strong>
                      </p>
                      <Counter
                        label="Cartons delivered"
                        value={q.cartons}
                        max={p.is_active ? available("BOTTLE_CARTON") : 0}
                        onChange={(n) => update(p.id, "cartons", n)}
                      />
                    </>
                  )}
                </Card>
              );
            })}
            <label className="grid gap-2 text-sm font-semibold">
              Payment instruction
              <select
                value={payment}
                onChange={(e) => setPayment(e.target.value)}
                className="min-h-14 rounded-lg border border-input bg-background px-3"
              >
                <option value="CASH">Cash</option>
                <option value="FONEPAY">Fonepay</option>
                <option value="UNPAID">Monthly credit / unpaid</option>
                <option value="PARTIAL">Partial payment</option>
              </select>
            </label>
            {payment !== "UNPAID" && (
              <label className="grid gap-2 text-sm font-semibold">
                Reported amount (NPR){payment !== "PARTIAL" && " — optional"}
                <Input
                  inputMode="decimal"
                  value={amount}
                  required={payment === "PARTIAL"}
                  pattern="[0-9]{1,12}(\.[0-9]{1,2})?"
                  maxLength={15}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </label>
            )}
            <label className="grid gap-2 text-sm font-semibold">
              Reference (optional)
              <Input
                value={reference}
                maxLength={200}
                onChange={(e) => setReference(e.target.value)}
              />
            </label>
            <label className="grid gap-2 text-sm font-semibold">
              Visit notes
              <Input
                value={notes}
                maxLength={2000}
                onChange={(e) => setNotes(e.target.value)}
              />
            </label>
            <p className="text-lg font-bold">
              Indicative delivery value: NPR {total}
            </p>
            <p className="text-sm text-muted-foreground">
              Server snapshots current default prices when saved. Payment
              instructions are pending Sprint 3 settlement; Fonepay is
              unverified.
            </p>
            {walkProblem && (
              <p role="alert" className="text-sm text-red-700">
                Walk-in jars need an equal empty exchange. Register the customer
                for jar custody or credit.
              </p>
            )}
            {custodyProblem && (
              <p role="alert" className="text-sm text-red-700">
                Empty collection exceeds the customer&apos;s tracked jars. Ask
                admin to verify legacy custody first.
              </p>
            )}
            <Button
              type="button"
              className="min-h-14 w-full"
              disabled={!eligible}
              onClick={() => setReview(true)}
            >
              Review delivery
            </Button>
          </>
        ) : (
          <div className="space-y-4 rounded-lg bg-muted p-5">
            <h3 className="text-lg font-semibold">Confirm delivery</h3>
            <p>{walk ? walkName : selected?.name}</p>
            {items.map((i) => (
              <p key={i.product_id}>
                {products.find((p) => p.id === i.product_id)?.name}:{" "}
                {i.full_jars} full delivered · {i.empty_jars} empty collected ·{" "}
                {i.cartons} cartons delivered
              </p>
            ))}
            <p>
              NPR {total} · {payment} · {amount || "No amount reported"}
            </p>
            <p className="text-sm">
              This saves an immutable visit. Financial settlement remains
              pending.
            </p>
            <Button
              type="button"
              variant="outline"
              onClick={() => setReview(false)}
            >
              Correct quantities
            </Button>
          </div>
        )}
      </OperationForm>
    </div>
  );
}
export function ReturnForm({
  workspace: w,
  trip,
  requestKey,
  admin,
}: {
  workspace: Workspace;
  trip: Trip;
  requestKey: string;
  admin: boolean;
}) {
  const expected = vehicleCounts(w, trip);
  const [values, setValues] = useState<Record<string, number>>({});
  const actual: Count[] = expected.map((c) => ({
    ...c,
    quantity: values[`${c.product_id}:${c.stock_kind}`] ?? c.quantity,
  }));
  const discrepancy = actual.some(
    (c, i) => c.quantity !== expected[i]!.quantity,
  );
  return (
    <OperationForm
      operation={admin ? "reconcile" : "submit"}
      trip={trip.id}
      requestKey={requestKey}
      label={admin ? "Post physical verification" : "Submit trip counts"}
      confirm={
        admin
          ? "Post these verified returns? Balanced counts or an explicit variance approval will close the physical trip."
          : "Submit these end-of-trip counts for admin verification? Deliveries will be locked."
      }
    >
      <input type="hidden" name="counts" value={JSON.stringify(actual)} />
      <p className="text-sm text-muted-foreground">
        {admin
          ? "Verify actual physical returns. Unsold full jars and collected empties stay separate."
          : "Count the stock on your vehicle. Submission does not transfer stock to the warehouse."}
      </p>
      {expected.map((c) => {
        const key = `${c.product_id}:${c.stock_kind}`;
        const declared = w.declarations.find(
          (d) => d.product_id === c.product_id && d.stock_kind === c.stock_kind,
        )?.quantity;
        return (
          <div
            key={key}
            className="space-y-3 rounded-xl border border-border p-4"
          >
            <p className="font-semibold">
              {w.products.find((p) => p.id === c.product_id)?.name}
            </p>
            <p className="text-sm">
              Expected: {c.quantity}
              {admin && ` · Driver declared: ${declared ?? "Not declared"}`}
            </p>
            <Counter
              label={`${stockLabels[c.stock_kind]} ${admin ? "verified" : "counted"}`}
              value={values[key] ?? c.quantity}
              onChange={(n) => setValues({ ...values, [key]: n })}
            />
          </div>
        );
      })}
      {admin && (
        <>
          <Field
            name="reason"
            label="Verification / discrepancy reason"
            required
            maxLength={500}
          />
          {discrepancy && (
            <label className="flex min-h-14 items-start gap-3 rounded-lg bg-amber-50 p-4 text-sm">
              <input
                type="checkbox"
                name="accept_variance"
                className="mt-1 size-5"
              />
              Explicitly approve the recorded variance and close. Leave
              unchecked to flag DISCREPANCY without moving warehouse stock.
            </label>
          )}
          <p className="text-xs text-muted-foreground">
            Physical closure does not settle payments or close the business day.
          </p>
        </>
      )}
    </OperationForm>
  );
}
