"use client";
import { useCallback, useState } from "react";
import { Field, OperationForm } from "./operation-form";
import { Input } from "./ui/input";
import { Message, T, Value, useLocale } from "./localization";
import { StockChangePreview } from "./stock-change-preview";
import { availableStock, stockPreview } from "@/domain/inventory/presentation";
import type { Product, StockKind } from "@/domain/inventory/validation";
import type { Balance } from "@/data-access/inventory";

export function ProcessingForm({
  day,
  products,
  operation,
  requestKey,
  balances,
  damaged,
}: {
  day: string;
  products: Product[];
  operation: "REFILL" | "DAMAGE";
  requestKey: string;
  balances: Balance[];
  damaged: { tracked: boolean; balances: Balance[] };
}) {
  const { t } = useLocale();
  const [productId, setProductId] = useState("");
  const [kind, setKind] = useState<StockKind>("EMPTY_JAR");
  const [quantity, setQuantity] = useState("");
  const [recorded, setRecorded] = useState(false);
  const markRecorded = useCallback(() => setRecorded(true), []);
  const product = products.find((p) => p.id === productId);
  const full = availableStock(balances, productId, "FULL_JAR"),
    empty = availableStock(balances, productId, "EMPTY_JAR");
  const damagedFull = availableStock(damaged.balances, productId, "FULL_JAR"),
    damagedEmpty = availableStock(damaged.balances, productId, "EMPTY_JAR");
  const available =
    operation === "REFILL" || kind === "EMPTY_JAR" ? empty : full;
  const preview = stockPreview(available, quantity, "decrease");
  const outputValid =
    operation === "REFILL"
      ? full + preview.amount <= 2147483647
      : (kind === "FULL_JAR" ? damagedFull : damagedEmpty) + preview.amount <=
        2147483647;
  const valid = preview.valid && outputValid;
  const cls =
    "min-h-11 w-full rounded-lg border border-input bg-background px-3 py-2 focus-visible:outline-2 focus-visible:outline-ring";
  const previewRows =
    operation === "REFILL"
      ? [
          { label: "Full jars", before: full, after: full + preview.amount },
          { label: "Empty jars", before: empty, after: empty - preview.amount },
        ]
      : [
          {
            label:
              kind === "FULL_JAR"
                ? "Available Full Jars"
                : "Available Empty Jars",
            before: available,
            after: preview.after,
          },
          ...(damaged.tracked
            ? [
                {
                  label: "Damaged / Quarantined Jars",
                  before: kind === "FULL_JAR" ? damagedFull : damagedEmpty,
                  after:
                    (kind === "FULL_JAR" ? damagedFull : damagedEmpty) +
                    preview.amount,
                },
              ]
            : []),
        ];
  return (
    <OperationForm
      preserveFields
      operation={`day:${operation}`}
      requestKey={requestKey}
      onSuccess={markRecorded}
      submitDisabled={!product || !valid || recorded}
      label={
        operation === "REFILL"
          ? "Record Completed Refill"
          : "Record Damaged Jars"
      }
      confirm={
        operation === "REFILL"
          ? "Record this completed refill? Each eligible empty jar becomes one full jar. Check the quantity and reason."
          : "Record these damaged jars? They will leave usable warehouse stock. Check the state, quantity and reason."
      }
    >
      <input type="hidden" name="day" value={day} />
      <label className="grid gap-2 text-sm font-semibold">
        <T k="Jar product" />
        <select
          aria-label={t("Jar product")}
          className={cls}
          name="product"
          required
          value={productId}
          onChange={(e) => {
            setProductId(e.target.value);
            setQuantity("");
          }}
        >
          <option value="">{t("Select product")}</option>
          {products
            .filter((p) => p.kind === "FULL_JAR")
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {!p.is_active && t(" · Inactive")}
              </option>
            ))}
        </select>
      </label>
      {product && (
        <div
          className="grid grid-cols-2 gap-2"
          data-testid="processing-availability"
        >
          {[
            ["Available Full Jars", full],
            ["Available Empty Jars", empty],
            [
              "Damaged / Quarantined Jars",
              damaged.tracked ? damagedFull + damagedEmpty : null,
            ],
            ["Available for Refilling", empty],
          ].map(([label, amount]) => (
            <div
              key={String(label)}
              className="min-w-0 rounded-lg border border-border p-3"
            >
              <p className="text-xs text-muted-foreground">
                <Message value={String(label)} />
              </p>
              <p
                className="mt-1 text-xl font-bold tabular-nums"
                data-testid={String(label)}
              >
                {amount === null ? (
                  <T k="Not tracked" />
                ) : (
                  <Value value={amount!} />
                )}
              </p>
            </div>
          ))}
        </div>
      )}
      {operation === "REFILL" ? (
        <input type="hidden" name="stock_kind" value="EMPTY_JAR" />
      ) : (
        <label className="grid gap-2 text-sm font-semibold">
          <T k="Damaged jar state" />
          <select
            aria-label={t("Damaged jar state")}
            className={cls}
            name="stock_kind"
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as StockKind);
              setQuantity("");
            }}
          >
            <option value="EMPTY_JAR">{t("Empty jars")}</option>
            <option value="FULL_JAR">{t("Full jars")}</option>
          </select>
        </label>
      )}
      <label className="grid gap-2 text-sm font-semibold">
        <Message
          value={
            operation === "REFILL"
              ? "Jars Successfully Refilled"
              : "Damaged jar quantity"
          }
        />
        <Input
          name="quantity"
          type="number"
          inputMode="numeric"
          required
          min={1}
          max={Math.min(available, 1000000000)}
          step={1}
          value={quantity}
          disabled={!product || available === 0}
          onChange={(e) => setQuantity(e.target.value)}
          aria-invalid={!!quantity && !valid}
        />
      </label>
      {product && (
        <p className="text-sm text-muted-foreground">
          <T k="Available for Selected State" />: <Value value={available} /> /{" "}
          <Message value={product.unit} />
        </p>
      )}
      {product && available === 0 && (
        <p role="status" className="text-sm text-amber-900">
          <T k="No usable stock is available for this operation." />
        </p>
      )}
      {!!quantity && !valid && (
        <p role="alert" className="text-sm text-red-800">
          <T k="Enter a whole quantity within the available stock and supported range." />
        </p>
      )}
      {product && quantity && !recorded && (
        <StockChangePreview rows={previewRows} valid={valid} />
      )}
      <Field
        name="reason"
        label={
          operation === "REFILL"
            ? "Processing Reason / Notes"
            : "Inspection Reason / Notes"
        }
        required
        maxLength={500}
      />
      <p className="text-xs text-muted-foreground">
        <Message
          value={
            operation === "REFILL"
              ? "Only record completed refills. Each usable empty becomes one full jar; record rejected jars separately as damage."
              : "Damaged jars move to the separate quarantine location and cannot be loaded or refilled."
          }
        />
      </p>
    </OperationForm>
  );
}
