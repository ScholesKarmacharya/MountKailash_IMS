"use client";
import Link from "next/link";
import { BsDateRange } from "./bs-date-picker";
import { T, useLocale } from "./localization";
import { Button } from "./ui/button";
import type { Product } from "@/domain/inventory/validation";
import { stockKinds, stockLabels } from "@/domain/inventory/validation";
import {
  movementLabels,
  type HistoryFilter,
} from "@/domain/inventory/presentation";

export function InventoryHistoryFilters({
  filter,
  products,
  prefix = "",
  mode = "movement",
  action,
  params = {},
}: {
  filter: HistoryFilter;
  products: Product[];
  prefix?: string;
  mode?: "movement" | "adjustment" | "processing";
  action: string;
  params?: Record<string, string | undefined>;
}) {
  const { t } = useLocale();
  const cls =
    "min-h-12 w-full min-w-0 rounded-lg border border-input bg-background px-3";
  const keep = Object.entries(params).filter(
    ([key, value]) =>
      value &&
      (prefix ? !key.startsWith(prefix) : key.startsWith("adjustment_")),
  );
  const reset = new URLSearchParams(keep as [string, string][]).toString();
  return (
    <form
      action={action}
      className="space-y-3"
      data-testid={mode + "-history-filters"}
    >
      {keep.map(([key, value]) => (
        <input key={key} type="hidden" name={key} value={value} />
      ))}
      <BsDateRange from={filter.from} to={filter.to} namePrefix={prefix} />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <label className="grid gap-2 text-sm font-semibold">
          <T k="Product" />
          <select
            aria-label={t("Product")}
            name={prefix + "product"}
            className={cls}
            defaultValue={filter.product}
          >
            <option value="">{t("All")}</option>
            {products
              .filter((p) => mode !== "processing" || p.kind === "FULL_JAR")
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
        </label>
        <label className="grid gap-2 text-sm font-semibold">
          <T k="Stock state" />
          <select
            aria-label={t("Stock state")}
            name={prefix + "state"}
            className={cls}
            defaultValue={filter.state}
          >
            <option value="">{t("All")}</option>
            {stockKinds
              .filter(
                (kind) => mode !== "processing" || kind !== "BOTTLE_CARTON",
              )
              .map((kind) => (
                <option key={kind} value={kind}>
                  {t(stockLabels[kind])}
                </option>
              ))}
          </select>
        </label>
        {mode === "movement" && (
          <>
            <label className="grid gap-2 text-sm font-semibold">
              <T k="Movement Type" />
              <select
                aria-label={t("Movement Type")}
                className={cls}
                name="type"
                defaultValue={filter.type}
              >
                <option value="">{t("All")}</option>
                {Object.entries(movementLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {t(label)}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-2 text-sm font-semibold">
              <T k="History Scope" />
              <select
                aria-label={t("History Scope")}
                className={cls}
                name="scope"
                defaultValue={filter.scope}
              >
                <option value="warehouse">
                  {t("Warehouse On-hand Activity")}
                </option>
                <option value="company">
                  {t("Company-wide Stock Activity")}
                </option>
              </select>
            </label>
          </>
        )}
      </div>
      <div className="flex flex-wrap gap-3">
        <Button type="submit">
          <T k="Filter history" />
        </Button>
        <Button asChild variant="outline">
          <Link href={action + (reset ? "?" + reset : "")}>
            <T k="Reset Filters" />
          </Link>
        </Button>
      </div>
    </form>
  );
}
