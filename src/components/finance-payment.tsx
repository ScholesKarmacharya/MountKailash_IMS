"use client";
import { useState, useId } from "react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { OperationForm } from "./operation-form";
import { allocations, cents, npr, sum } from "@/domain/finance/money";
import type { FinanceWorkspace } from "@/domain/finance/types";
import type { Workspace, Trip } from "@/domain/operations/types";
export function AmountInput({
  label,
  value,
  onChange,
  required = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
}) {
  return (
    <label className="grid gap-2 text-sm font-semibold">
      {label}
      <Input
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        pattern="[0-9]{1,12}(\.[0-9]{1,2})?"
        maxLength={15}
        required={required}
        className="min-h-14 text-lg"
      />
    </label>
  );
}
export function PaymentButtons({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-semibold">Payment method</legend>
      <div className="grid grid-cols-2 gap-3">
        {[
          ["CASH", "Cash"],
          ["FONEPAY", "Fonepay"],
          ["UNPAID", "Monthly credit / unpaid"],
          ["PARTIAL", "Partial payment"],
        ].map(([v, label]) => (
          <Button
            key={v}
            type="button"
            aria-pressed={value === v}
            variant={value === v ? "default" : "outline"}
            className="min-h-16 whitespace-normal"
            onClick={() => onChange(v!)}
          >
            {label}
          </Button>
        ))}
      </div>
    </fieldset>
  );
}
export function CollectCreditForm({
  finance: f,
  workspace: w,
  trip,
  requestKey,
}: {
  finance: FinanceWorkspace;
  workspace: Workspace;
  trip: Trip;
  requestKey: string;
}) {
  const customerInput = useId(),
    methodInput = useId();
  const [customer, setCustomer] = useState(""),
    [amount, setAmount] = useState(""),
    [method, setMethod] = useState("CASH"),
    [reference, setReference] = useState("");
  const credit = f.credit.filter((i) => i.customer_id === customer);
  let error = "",
    list: { invoice_id: string; amount: string }[] = [];
  try {
    list = allocations(amount || "0", credit);
  } catch (e) {
    error = (e as Error).message;
  }
  return (
    <OperationForm
      operation="finance:PAYMENT"
      trip={trip.id}
      requestKey={requestKey}
      label="Collect outstanding credit"
      showSubmit={!!customer && list.length > 0 && !error}
      confirm={`Record ${amount} NPR ${method} against existing invoices? Fonepay remains pending until reconciled.`}
    >
      <div className="grid gap-2 text-sm font-semibold">
        <label htmlFor={customerInput}>Collection customer</label>
        <select
          id={customerInput}
          value={customer}
          onChange={(e) => setCustomer(e.target.value)}
          className="min-h-12 rounded-lg border px-3"
        >
          <option value="">Choose assigned customer</option>
          {w.customers
            .filter((c) =>
              w.route.some(
                (r) => r.customer_id === c.id && r.trip_id === trip.id,
              ),
            )
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
        </select>
      </div>
      <input type="hidden" name="customer" value={customer} />
      <input
        type="hidden"
        name="payment_data"
        value={JSON.stringify({
          method,
          amount,
          reference,
          allocations: list,
          deposit_amount: "0",
        })}
      />
      <p>
        Outstanding: {npr(sum(credit.map((i) => i.outstanding)))} · Available to
        collect: {npr(sum(credit.map((i) => i.available)))}
      </p>
      <AmountInput
        label="Credit amount received (NPR)"
        value={amount}
        onChange={setAmount}
        required
      />
      <div className="grid gap-2 text-sm font-semibold">
        <label htmlFor={methodInput}>Receipt method</label>
        <select
          id={methodInput}
          value={method}
          onChange={(e) => setMethod(e.target.value)}
          className="min-h-12 w-full rounded-lg border px-3"
        >
          <option value="CASH">Cash</option>
          <option value="FONEPAY">Fonepay pending</option>
        </select>
      </div>
      <AmountReference value={reference} onChange={setReference} />
      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
      <p className="text-sm text-muted-foreground">
        Applied to available invoices oldest first. Collections do not create
        new sales.
      </p>
    </OperationForm>
  );
}
export function AmountReference({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="grid gap-2 text-sm font-semibold">
      Transaction reference (unverified)
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={200}
      />
    </label>
  );
}
export function InvoicePaymentForm({
  invoice,
  customer,
  trip,
  requestKey,
  available,
}: {
  invoice: string;
  customer: string | null;
  trip: string;
  requestKey: string;
  available: string;
}) {
  const [amount, setAmount] = useState(""),
    [method, setMethod] = useState("CASH"),
    [reference, setReference] = useState("");
  let error = "";
  try {
    if (amount && cents(amount) > cents(available))
      error = "Receipt exceeds available invoice balance.";
  } catch (e) {
    error = (e as Error).message;
  }
  return (
    <OperationForm
      operation="finance:PAYMENT"
      trip={trip}
      requestKey={requestKey}
      label="Record invoice receipt"
      showSubmit={!!amount && !error}
      confirm={`Record ${amount} NPR ${method} against this invoice? Fonepay remains pending.`}
    >
      <input type="hidden" name="invoice" value={invoice} />
      <input type="hidden" name="customer" value={customer ?? ""} />
      <input
        type="hidden"
        name="payment_data"
        value={JSON.stringify({
          method,
          amount,
          reference,
          deposit_amount: "0",
          current_amount: customer ? "0" : amount,
          allocations: customer ? [{ invoice_id: invoice, amount }] : [],
        })}
      />
      <p>Available to collect: {npr(available)}</p>
      <AmountInput
        label="Invoice amount received (NPR)"
        value={amount}
        onChange={setAmount}
        required
      />
      <div className="grid grid-cols-2 gap-3">
        {["CASH", "FONEPAY"].map((m) => (
          <Button
            key={m}
            type="button"
            aria-pressed={method === m}
            variant={method === m ? "default" : "outline"}
            onClick={() => setMethod(m)}
          >
            {m === "CASH" ? "Cash receipt" : "Fonepay pending"}
          </Button>
        ))}
      </div>
      <AmountReference value={reference} onChange={setReference} />
      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
    </OperationForm>
  );
}
