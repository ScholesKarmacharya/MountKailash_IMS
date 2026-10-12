"use client";
import { T, Message, Value } from "@/components/localization";

import { useState } from "react";
import { Field, OperationForm, Select } from "./operation-form";
import type { Day } from "@/domain/business-days/types";
import type { Product } from "@/domain/inventory/validation";
import { Input } from "./ui/input";
import { npr } from "@/domain/finance/money";
export function DayReviewForm({
  day,
  requestKey,
  blocked,
}: {
  day: Day;
  requestKey: string;
  blocked: boolean;
}) {
  return (
    <OperationForm
      operation="day:REVIEW"
      requestKey={requestKey}
      version={day.version}
      label="Begin closing review"
      showSubmit={!blocked}
      confirm="Freeze new transactions for this day and begin closing review?"
    >
      <input type="hidden" name="day" value={day.id} />
      <p className="text-sm text-muted-foreground">
        <T k="Resolve all linked blockers first. Review freezes day transactions until you close or explicitly resume operations." />
      </p>
    </OperationForm>
  );
}
export function DayCloseForm({
  day,
  requestKey,
  cash,
}: {
  day: Day;
  requestKey: string;
  cash: string;
}) {
  const [counted, setCounted] = useState("");
  const [notes, setNotes] = useState("");
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  return (
    <OperationForm
      operation="day:CLOSE"
      requestKey={requestKey}
      version={day.version}
      label="Confirm and close business day"
      confirm={`Permanently close business day ${day.date_label} and archive its reconciled balances?`}
    >
      <input type="hidden" name="day" value={day.id} />
      <p className="text-sm">
        {" "}
        <T k="Expected net cash:" />{" "}
        <strong>
          <Value value={npr(cash)} />
        </strong>
        <T k=". Enter receipts less reversals and cash refunds. A net refund outflow uses a negative amount." />{" "}
      </p>
      <label className="grid gap-2 text-sm font-medium">
        {" "}
        <T k="Net cash handed over (NPR)" />{" "}
        <Input
          name="cash_counted"
          required
          inputMode="decimal"
          maxLength={17}
          placeholder="Enter the actual amount"
          value={counted}
          onChange={(event) => setCounted(event.target.value)}
        />
      </label>
      <label className="grid gap-2 text-sm font-medium">
        {" "}
        <T k="Reconciliation evidence / closing notes" />{" "}
        <Input
          name="notes"
          required
          maxLength={2000}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
        />
      </label>
      {[
        [
          "cash_checked",
          "I checked cash receipts, reversals, refunds and the net handover.",
        ],
        [
          "fonepay_checked",
          "I checked all Fonepay receipts against independent merchant/bank evidence.",
        ],
        [
          "stock_checked",
          "I checked full jars, empty jars, cartons, damages and physical returns.",
        ],
        [
          "balances_checked",
          "I checked customer credit, jar custody and refundable deposits carried forward.",
        ],
        [
          "confirmed",
          "I confirm closing this day and preserving its immutable report.",
        ],
      ].map(([name, label]) => (
        <label key={name} className="flex min-h-12 items-start gap-3 text-sm">
          <input
            className="mt-1 size-5 shrink-0 accent-primary"
            type="checkbox"
            name={name}
            required
            checked={checks[name!] ?? false}
            onChange={(event) =>
              setChecks((previous) => ({
                ...previous,
                [name!]: event.target.checked,
              }))
            }
          />
          <Message value={label} />
        </label>
      ))}
    </OperationForm>
  );
}
export function ResumeDayForm({
  day,
  requestKey,
}: {
  day: Day;
  requestKey: string;
}) {
  return (
    <OperationForm
      operation="day:RESUME"
      requestKey={requestKey}
      version={day.version}
      label="Resume operations"
      confirm="Cancel the closing review and allow transactions on this day again?"
    >
      <input type="hidden" name="day" value={day.id} />
      <Field
        name="reason"
        label="Reason for resuming operations"
        required
        maxLength={500}
      />
    </OperationForm>
  );
}
export function ProcessingForm({
  day,
  products,
  operation,
  requestKey,
}: {
  day: string;
  products: Product[];
  operation: "REFILL" | "DAMAGE";
  requestKey: string;
}) {
  return (
    <OperationForm
      operation={`day:${operation}`}
      requestKey={requestKey}
      label={
        operation === "REFILL"
          ? "Record completed refill"
          : "Record damaged jars"
      }
    >
      <input type="hidden" name="day" value={day} />
      <Select label="Jar product" name="product">
        <option value="">
          <T k="Select product" />
        </option>
        {products
          .filter((p) => p.kind === "FULL_JAR")
          .map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
      </Select>
      {operation === "REFILL" ? (
        <input type="hidden" name="stock_kind" value="EMPTY_JAR" />
      ) : (
        <Select name="stock_kind" label="Damaged jar state">
          <option value="EMPTY_JAR">
            <T k="Empty jars" />
          </option>
          <option value="FULL_JAR">
            <T k="Full jars" />
          </option>
        </Select>
      )}
      <label className="grid gap-2 text-sm font-medium">
        <Message
          value={
            operation === "REFILL"
              ? "Eligible empties successfully refilled"
              : "Damaged jar quantity"
          }
        />
        <Input
          type="number"
          name="quantity"
          required
          min={1}
          max={1000000000}
          step={1}
          inputMode="numeric"
        />
      </label>
      <Field
        name="reason"
        label="Processing reason / inspection notes"
        required
        maxLength={500}
      />
      <p className="text-sm text-muted-foreground">
        <Message
          value={
            operation === "REFILL"
              ? "Record completed processing only. Each eligible empty becomes one full jar; rejected jars must be recorded as damage separately."
              : "Jars move out of available warehouse stock into the separate damaged location. They cannot be loaded or refilled."
          }
        />
      </p>
    </OperationForm>
  );
}
export function ClosedStockCorrection({
  original,
  posting,
  products,
  requestKey,
}: {
  original: string;
  posting: string;
  products: Product[];
  requestKey: string;
}) {
  return (
    <OperationForm
      operation="day:STOCK_CORRECTION"
      requestKey={requestKey}
      label="Post linked stock correction"
    >
      <input type="hidden" name="day" value={original} />
      <input type="hidden" name="posting_day" value={posting} />
      <Select name="product" label="Correction product">
        <option value="">
          <T k="Select product" />
        </option>
        {products.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </Select>
      <Select name="stock_kind" label="Correction stock state">
        <option value="FULL_JAR">
          <T k="Full jars" />
        </option>
        <option value="EMPTY_JAR">
          <T k="Empty jars" />
        </option>
        <option value="BOTTLE_CARTON">
          <T k="Water cartons" />
        </option>
      </Select>
      <label className="grid gap-2 text-sm font-medium">
        {" "}
        <T k="Signed quantity correction" />{" "}
        <Input
          name="delta"
          type="number"
          required
          step={1}
          min={-1000000000}
          max={1000000000}
        />
      </label>
      <Field
        name="reason"
        label="Reason for correcting the closed day"
        required
        maxLength={500}
      />
      <p className="text-sm text-muted-foreground">
        <T k="This creates a new movement on the current OPEN day and an amendment link. The original closing quantities remain archived." />
      </p>
    </OperationForm>
  );
}
