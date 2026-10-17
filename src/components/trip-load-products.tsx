"use client";

import type { Count } from "@/domain/operations/types";
import {
  warehouseAvailable,
  type TripLoadingWorkspace,
} from "@/domain/operations/trip-loading";
import { tr } from "@/domain/localization/format";
import { Counter } from "./operation-form";
import { T, useLocale } from "./localization";

export function TripLoadProducts({
  workspace: w,
  items,
  onChange,
  selectProducts = false,
}: {
  workspace: TripLoadingWorkspace;
  items: Count[];
  onChange: (items: Count[]) => void;
  selectProducts?: boolean;
}) {
  const { locale } = useLocale();
  const products = w.products.filter((p) => p.is_active);
  return (
    <div className="grid min-w-0 gap-3 lg:grid-cols-2">
      {products.map((p) => {
        const item = items.find((i) => i.product_id === p.id);
        const available = warehouseAvailable(w, p.id);
        const update = (quantity: number) =>
          onChange([
            ...items.filter((i) => i.product_id !== p.id),
            ...(selectProducts || quantity > 0
              ? [{ product_id: p.id, stock_kind: p.kind, quantity }]
              : []),
          ]);
        return (
          <div
            key={p.id}
            data-testid={`load-product-${p.id}`}
            className="min-w-0 space-y-3 rounded-xl border border-border p-4"
          >
            {selectProducts ? (
              <label className="flex min-h-12 items-center gap-3 font-semibold">
                <input
                  type="checkbox"
                  className="size-5"
                  checked={!!item}
                  onChange={(e) =>
                    e.target.checked
                      ? update(0)
                      : onChange(items.filter((i) => i.product_id !== p.id))
                  }
                />
                {p.name}
              </label>
            ) : (
              <h4 className="break-words font-semibold">{p.name}</h4>
            )}
            <p className="text-sm text-muted-foreground">
              <T k="Warehouse available: {0}" values={[available]} />
            </p>
            {(!selectProducts || item) && (
              <Counter
                label={tr(locale, "{0} load", [p.name])}
                value={item?.quantity ?? 0}
                max={Math.min(1000000000, available)}
                onChange={(quantity) => update(Math.min(quantity, available))}
              />
            )}
            {item && item.quantity > available && (
              <p role="alert" className="text-sm text-red-700">
                <T
                  k="Requested {0} {1}, but only {2} are now available."
                  values={[item.quantity, p.name, available]}
                />
              </p>
            )}
          </div>
        );
      })}
      {!products.length && (
        <p>
          <T k="No active products are available to load." />
        </p>
      )}
    </div>
  );
}
