"use client";
import { LocalizedSelect, LocalizedTextarea } from "@/components/localization";

import { T, Message, useLocale } from "@/components/localization";

import { useActionState, useEffect, useState } from "react";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { DialogClose } from "./admin-dialog";
import { Value } from "./localization";
import { npr } from "@/domain/finance/money";
import type { Balance } from "@/data-access/inventory";
import { availableStock, stockPreview } from "@/domain/inventory/presentation";
import { StockChangePreview } from "./stock-change-preview";
import {
  adjustStockAction,
  openDayAction,
  saveProductAction,
  type SaveState,
} from "@/app/admin/inventory/actions";
import {
  stockLabels,
  type Product,
  type StockKind,
} from "@/domain/inventory/validation";
const selectClass =
  "min-h-11 w-full rounded-lg border border-input bg-background px-3 py-2 focus-visible:outline-2 focus-visible:outline-ring";
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="grid gap-2 text-sm font-semibold">
      <Message value={label} />
      {children}
    </label>
  );
}
function Feedback({
  state,
  reset = true,
}: {
  state: SaveState;
  reset?: boolean;
}) {
  return (
    <>
      {state?.error && (
        <p
          role="alert"
          className="rounded-lg bg-red-50 p-3 text-sm text-red-800"
        >
          <Message value={state.error} />
        </p>
      )}
      {state?.success && (
        <div
          role="status"
          className="space-y-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900"
        >
          <p>
            <Message value={state.success} />
          </p>
          {reset && (
            <Button
              type="button"
              variant="outline"
              onClick={() => window.location.reload()}
            >
              <T k="Start another entry" />
            </Button>
          )}
        </div>
      )}
    </>
  );
}
function useUnsaved(success: boolean) {
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!dirty || success) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, success]);
  return { dirty: dirty && !success, markDirty: () => setDirty(true) };
}
export function ProductForm({
  product,
  requestKey,
  productId,
}: {
  product?: Product;
  requestKey: string;
  productId: string;
}) {
  const [state, action, pending] = useActionState(saveProductAction, null);
  const [kind, setKind] = useState<Product["kind"]>(
    product?.kind ?? "FULL_JAR",
  );
  const [unit, setUnit] = useState(product?.unit ?? "jar");
  const [price, setPrice] = useState(product?.default_price ?? "");
  const { t } = useLocale();
  const { dirty, markDirty } = useUnsaved(Boolean(state?.success));
  return (
    <form
      action={action}
      onChange={markDirty}
      className="space-y-4"
      aria-busy={pending}
    >
      <input type="hidden" name="key" value={requestKey} />
      <input type="hidden" name="id" value={productId} />
      <input type="hidden" name="version" value={product?.version ?? 0} />
      <fieldset
        disabled={pending || Boolean(state?.success)}
        className="grid gap-4 sm:grid-cols-2"
      >
        <Field label="Product name">
          <Input
            name="name"
            required
            maxLength={120}
            defaultValue={product?.name}
          />
        </Field>
        <Field label="SKU">
          <Input
            name="sku"
            required
            maxLength={40}
            defaultValue={product?.sku}
            pattern="[A-Za-z0-9][A-Za-z0-9_-]{0,39}"
            readOnly={!!product}
            className={product ? "bg-muted" : undefined}
          />
        </Field>
        <Field label="Product kind">
          {product ? (
            <>
              <input type="hidden" name="kind" value={product.kind} />
              <p className="py-3 font-normal">
                <Message
                  value={
                    product.kind === "FULL_JAR"
                      ? "20L returnable water jar"
                      : "Bottled-water carton"
                  }
                />
              </p>
            </>
          ) : (
            <LocalizedSelect
              name="kind"
              aria-label={t("Product kind")}
              className={selectClass}
              value={kind}
              onChange={(e) => {
                const next = e.target.value as Product["kind"];
                if (!unit || unit === (kind === "FULL_JAR" ? "jar" : "carton"))
                  setUnit(next === "FULL_JAR" ? "jar" : "carton");
                setKind(next);
              }}
            >
              <option value="FULL_JAR">
                <T k="20L returnable water jar" />
              </option>
              <option value="BOTTLE_CARTON">
                <T k="Bottled-water carton" />
              </option>
            </LocalizedSelect>
          )}
        </Field>
        <Field label="Unit">
          <Input
            name="unit"
            required
            maxLength={40}
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
            readOnly={!!product}
            className={product ? "bg-muted" : undefined}
          />
        </Field>
        <Field label="Default selling price (NPR)">
          <Input
            name="price"
            inputMode="decimal"
            required
            pattern="[0-9]{1,12}(\.[0-9]{1,2})?"
            value={price}
            maxLength={15}
            onChange={(e) => setPrice(e.target.value)}
          />
        </Field>
        <Field label="Status">
          <LocalizedSelect
            name="active"
            aria-label={t("Status")}
            className={selectClass}
            defaultValue={String(product?.is_active ?? true)}
          >
            <option value="true">
              <T k="Active" />
            </option>
            <option value="false">
              <T k="Inactive" />
            </option>
          </LocalizedSelect>
        </Field>
        <div className="sm:col-span-2">
          <Field label="Reason for catalog change">
            <Input name="reason" required minLength={3} maxLength={500} />
          </Field>
        </div>
      </fieldset>
      {product ? (
        <p className="text-xs text-muted-foreground">
          <T k="SKU, product kind and unit are fixed to protect stock and transaction history." />
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          <T k="Jar or carton is suggested from the product kind. You can enter your actual unit before saving." />
        </p>
      )}
      <p
        className="text-sm text-muted-foreground"
        data-testid="product-price-preview"
      >
        <T k="Selling price per unit" />:{" "}
        {/^[0-9]{1,12}(\.[0-9]{1,2})?$/.test(price) ? (
          <>
            <Value value={npr(price)} /> / <Message value={unit} />
          </>
        ) : (
          <T k="Enter a valid selling price." />
        )}
      </p>
      <p className="text-xs text-muted-foreground">
        <T k="An audit reason is required for creation and edits." />
      </p>
      {dirty && (
        <p className="text-sm text-amber-900">
          <T k="Unsaved changes. Save before leaving this page." />
        </p>
      )}
      <Feedback state={state} reset={false} />
      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={pending || Boolean(state?.success)}>
          <Message value={pending ? "Saving…" : "Save Product"} />
        </Button>
        <DialogClose
          disabled={pending}
          label={state?.success ? "Close" : "Cancel"}
        />
      </div>
    </form>
  );
}
export function AdjustmentForm({
  products,
  balances,
  dayId,
  requestKey,
}: {
  products: Product[];
  balances: Balance[];
  dayId: string;
  requestKey: string;
}) {
  const { t } = useLocale();
  const [state, action, pending] = useActionState(adjustStockAction, null);
  const [productId, setProductId] = useState(products[0]?.id ?? "");
  const [stableKey] = useState(requestKey);
  const [kind, setKind] = useState<StockKind>(
    products[0]?.kind === "BOTTLE_CARTON" ? "BOTTLE_CARTON" : "FULL_JAR",
  );
  const [direction, setDirection] = useState<"increase" | "decrease">(
    "increase",
  );
  const [quantity, setQuantity] = useState("");
  const product = products.find((p) => p.id === productId);
  const before = availableStock(balances, productId, kind);
  const preview = stockPreview(before, quantity, direction);
  const { dirty, markDirty } = useUnsaved(Boolean(state?.success));
  return (
    <form
      action={action}
      onReset={(event) => event.preventDefault()}
      onChange={markDirty}
      onSubmit={(event) => {
        if (
          !window.confirm(
            t(
              "Post this stock correction? It will create a permanent history entry. Check the quantity, direction and reason.",
            ),
          )
        )
          event.preventDefault();
      }}
      className="space-y-4"
      aria-busy={pending}
    >
      <input type="hidden" name="key" value={stableKey} />
      <input type="hidden" name="day" value={dayId} />
      <fieldset
        disabled={pending || Boolean(state?.success)}
        className="grid gap-4 sm:grid-cols-2"
      >
        <Field label="Product">
          <LocalizedSelect
            name="product"
            aria-label={t("Product")}
            className={selectClass}
            value={productId}
            onChange={(event) => {
              setProductId(event.target.value);
              setKind(
                products.find((p) => p.id === event.target.value)?.kind ===
                  "BOTTLE_CARTON"
                  ? "BOTTLE_CARTON"
                  : "FULL_JAR",
              );
              setQuantity("");
            }}
          >
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.sku}){!p.is_active && <T k=" · Inactive" />}
              </option>
            ))}
          </LocalizedSelect>
        </Field>
        <Field label="Stock state">
          <LocalizedSelect
            key={product?.kind}
            name="kind"
            aria-label={t("Stock state")}
            value={kind}
            onChange={(event) => {
              setKind(event.target.value as StockKind);
              setQuantity("");
            }}
            className={selectClass}
          >
            {(product?.kind === "FULL_JAR"
              ? (["FULL_JAR", "EMPTY_JAR"] as const)
              : (["BOTTLE_CARTON"] as const)
            ).map((kind) => (
              <option key={kind} value={kind}>
                <Message value={stockLabels[kind]} />
              </option>
            ))}
          </LocalizedSelect>
        </Field>
        <Field label="Direction">
          <LocalizedSelect
            name="direction"
            aria-label={t("Direction")}
            className={selectClass}
            value={direction}
            onChange={(event) =>
              setDirection(event.target.value as "increase" | "decrease")
            }
          >
            <option value="increase">
              <T k="Increase stock" />
            </option>
            <option value="decrease">
              <T k="Decrease stock" />
            </option>
          </LocalizedSelect>
        </Field>
        <Field label="Quantity">
          <Input
            name="quantity"
            type="number"
            inputMode="numeric"
            required
            min={1}
            max={
              direction === "decrease"
                ? Math.min(before, 1000000000)
                : Math.min(2147483647 - before, 1000000000)
            }
            step={1}
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
            aria-invalid={!!quantity && !preview.valid}
          />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Adjustment reason">
            <Input name="reason" required minLength={3} maxLength={500} />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="Supporting notes (optional)">
            <LocalizedTextarea
              name="notes"
              maxLength={2000}
              className={selectClass}
            />
          </Field>
        </div>
      </fieldset>
      {!state?.success && (
        <>
          <p className="text-sm text-muted-foreground">
            <T k="Available for Selected State" />: <Value value={before} /> /{" "}
            <Message value={product?.unit ?? ""} />
          </p>
          {quantity && (
            <StockChangePreview
              rows={[
                { label: stockLabels[kind], before, after: preview.after },
              ]}
              valid={preview.valid}
            />
          )}
          {quantity && !preview.valid && (
            <p role="alert" className="text-sm text-red-800">
              <T k="Enter a whole quantity within the available stock and supported range." />
            </p>
          )}
        </>
      )}
      <p className="text-sm text-muted-foreground">
        <T k="Manual corrections only. Loading, deliveries, returns and refilling will use their own workflows. Inactive products keep their stock and remain available for corrections." />
      </p>
      {dirty && (
        <p className="text-sm text-amber-900">
          <T k="Unsaved adjustment. Save before leaving this page." />
        </p>
      )}
      <Feedback state={state} reset={false} />
      <div className="flex flex-wrap gap-3">
        <Button
          type="submit"
          disabled={pending || Boolean(state?.success) || !preview.valid}
        >
          <Message value={pending ? "Posting…" : "Post adjustment"} />
        </Button>
        <DialogClose
          disabled={pending}
          label={state?.success ? "Close" : "Cancel"}
        />
      </div>
    </form>
  );
}
export function OpenDayForm({ requestKey }: { requestKey: string }) {
  const { t } = useLocale();
  const [state, action, pending] = useActionState(openDayAction, null);
  return (
    <form
      action={action}
      className="space-y-4"
      onSubmit={(event) => {
        if (
          !window.confirm(
            t(
              "Open a business day for warehouse operations? Its date uses Nepal time and existing balances carry forward.",
            ),
          )
        )
          event.preventDefault();
      }}
    >
      <input name="key" type="hidden" value={requestKey} />
      <Feedback state={state} />
      <Button disabled={pending || Boolean(state?.success)} type="submit">
        <Message value={pending ? "Opening…" : "Open business day"} />
      </Button>
    </form>
  );
}
