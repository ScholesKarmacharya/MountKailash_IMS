"use client";
import { useActionState, useEffect, useState } from "react";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import {
  adjustStockAction,
  openDayAction,
  saveProductAction,
  type SaveState,
} from "@/app/admin/inventory/actions";
import { stockLabels, type Product } from "@/domain/inventory/validation";
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
      {label}
      {children}
    </label>
  );
}
function Feedback({ state }: { state: SaveState }) {
  return (
    <>
      {state?.error && (
        <p
          role="alert"
          className="rounded-lg bg-red-50 p-3 text-sm text-red-800"
        >
          {state.error}
        </p>
      )}
      {state?.success && (
        <div
          role="status"
          className="space-y-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900"
        >
          <p>{state.success}</p>
          <Button
            type="button"
            variant="outline"
            onClick={() => window.location.reload()}
          >
            Start another entry
          </Button>
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
          />
        </Field>
        <Field label="Product kind">
          {product ? (
            <>
              <input type="hidden" name="kind" value={product.kind} />
              <p className="py-3 font-normal">
                {product.kind === "FULL_JAR"
                  ? "20L returnable water jar"
                  : "Bottled-water carton"}
              </p>
            </>
          ) : (
            <select name="kind" className={selectClass} defaultValue="FULL_JAR">
              <option value="FULL_JAR">20L returnable water jar</option>
              <option value="BOTTLE_CARTON">Bottled-water carton</option>
            </select>
          )}
        </Field>
        <Field label="Unit">
          <Input
            name="unit"
            required
            maxLength={40}
            placeholder="jar or carton"
            defaultValue={product?.unit}
          />
        </Field>
        <Field label="Default selling price (NPR)">
          <Input
            name="price"
            inputMode="decimal"
            required
            pattern="[0-9]{1,12}(\.[0-9]{1,2})?"
            defaultValue={product?.default_price}
          />
        </Field>
        <Field label="Status">
          <select
            name="active"
            className={selectClass}
            defaultValue={String(product?.is_active ?? true)}
          >
            <option value="true">Active</option>
            <option value="false">Inactive</option>
          </select>
        </Field>
        <div className="sm:col-span-2">
          <Field label="Reason for catalog change">
            <Input name="reason" required minLength={3} maxLength={500} />
          </Field>
        </div>
      </fieldset>
      {dirty && (
        <p className="text-sm text-amber-900">
          Unsaved changes. Save before leaving this page.
        </p>
      )}
      <Feedback state={state} />
      <Button type="submit" disabled={pending || Boolean(state?.success)}>
        {pending ? "Saving…" : product ? "Save product" : "Create product"}
      </Button>
    </form>
  );
}
export function AdjustmentForm({
  products,
  dayId,
  requestKey,
}: {
  products: Product[];
  dayId: string;
  requestKey: string;
}) {
  const [state, action, pending] = useActionState(adjustStockAction, null);
  const [productId, setProductId] = useState(products[0]?.id ?? "");
  const product = products.find((p) => p.id === productId);
  const { dirty, markDirty } = useUnsaved(Boolean(state?.success));
  return (
    <form
      action={action}
      onChange={markDirty}
      onSubmit={(event) => {
        if (
          !window.confirm(
            "Post this stock correction? It will create a permanent history entry. Check the quantity, direction and reason.",
          )
        )
          event.preventDefault();
      }}
      className="space-y-4"
      aria-busy={pending}
    >
      <input type="hidden" name="key" value={requestKey} />
      <input type="hidden" name="day" value={dayId} />
      <fieldset
        disabled={pending || Boolean(state?.success)}
        className="grid gap-4 sm:grid-cols-2"
      >
        <Field label="Product">
          <select
            name="product"
            className={selectClass}
            value={productId}
            onChange={(event) => setProductId(event.target.value)}
          >
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.sku}){!p.is_active && " · Inactive"}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Stock state">
          <select key={product?.kind} name="kind" className={selectClass}>
            {(product?.kind === "FULL_JAR"
              ? (["FULL_JAR", "EMPTY_JAR"] as const)
              : (["BOTTLE_CARTON"] as const)
            ).map((kind) => (
              <option key={kind} value={kind}>
                {stockLabels[kind]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Direction">
          <select name="direction" className={selectClass}>
            <option value="increase">Increase stock</option>
            <option value="decrease">Decrease stock</option>
          </select>
        </Field>
        <Field label="Quantity">
          <Input
            name="quantity"
            type="number"
            inputMode="numeric"
            required
            min={1}
            max={1000000000}
            step={1}
          />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Adjustment reason">
            <Input name="reason" required minLength={3} maxLength={500} />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="Supporting notes (optional)">
            <textarea name="notes" maxLength={2000} className={selectClass} />
          </Field>
        </div>
      </fieldset>
      <p className="text-sm text-muted-foreground">
        Manual corrections only. Loading, deliveries, returns and refilling will
        use their own workflows. Inactive products keep their stock and remain
        available for corrections.
      </p>
      {dirty && (
        <p className="text-sm text-amber-900">
          Unsaved adjustment. Save before leaving this page.
        </p>
      )}
      <Feedback state={state} />
      <Button type="submit" disabled={pending || Boolean(state?.success)}>
        {pending ? "Posting…" : "Post adjustment"}
      </Button>
    </form>
  );
}
export function OpenDayForm({ requestKey }: { requestKey: string }) {
  const [state, action, pending] = useActionState(openDayAction, null);
  return (
    <form
      action={action}
      className="space-y-4"
      onSubmit={(event) => {
        if (
          !window.confirm(
            "Open a business day for warehouse operations? Its date uses Nepal time. Closing and reconciliation arrive in Sprint 4.",
          )
        )
          event.preventDefault();
      }}
    >
      <input name="key" type="hidden" value={requestKey} />
      <Feedback state={state} />
      <Button disabled={pending || Boolean(state?.success)} type="submit">
        {pending ? "Opening…" : "Open business day"}
      </Button>
    </form>
  );
}
