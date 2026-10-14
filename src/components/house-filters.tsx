"use client";
import { useState, type ReactNode } from "react";
import Link from "next/link";
import type { HouseWorkspace } from "@/domain/house/types";
import { BsDatePicker } from "./bs-date-picker";
import { T, useLocale } from "./localization";
import { Button } from "./ui/button";
export function HouseFilters({
  workspace: w,
  filter,
  children,
}: {
  workspace: HouseWorkspace;
  filter: {
    preset: string;
    from: string;
    to: string;
    customer: string | null;
    driver: string | null;
    product: string | null;
  };
  children?: ReactNode;
}) {
  const [preset, setPreset] = useState(filter.preset),
    { t } = useLocale();
  const cls = "min-h-12 w-full rounded-lg border border-input bg-card p-3";
  return (
    <form
      className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
      data-testid="free-supply-filters"
    >
      <label className="grid gap-2 text-sm font-semibold">
        <T k="Date range" />
        <select
          aria-label={t("Date range")}
          className={cls}
          name="preset"
          value={preset}
          onChange={(e) => setPreset(e.target.value)}
        >
          <option value="today">{t("Today")}</option>
          <option value="month">{t("This BS Month")}</option>
          <option value="custom">{t("Custom BS Date Range")}</option>
        </select>
      </label>
      {preset === "custom" && (
        <>
          <div className="grid gap-2 text-sm font-semibold">
            <span>
              <T k="From BS date" />
            </span>
            <BsDatePicker
              name="from"
              defaultValue={filter.from}
              label="From BS date"
              required
            />
          </div>
          <div className="grid gap-2 text-sm font-semibold">
            <span>
              <T k="To BS date" />
            </span>
            <BsDatePicker
              name="to"
              defaultValue={filter.to}
              label="To BS date"
              required
            />
          </div>
        </>
      )}
      {(
        [
          ["customer", "Customer", w.customers],
          ["driver", "Driver", w.drivers],
          ["product", "Product", w.products],
        ] as const
      ).map(([name, label, rows]) => (
        <label className="grid gap-2 text-sm font-semibold" key={name}>
          <T k={label} />
          <select
            aria-label={t(label)}
            className={cls}
            name={name}
            defaultValue={filter[name] ?? ""}
          >
            <option value="">{t("All")}</option>
            {rows.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
      ))}
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2 xl:col-span-4">
        <Button type="submit">
          <T k="Filter" />
        </Button>
        <Button asChild variant="outline">
          <Link href="/admin/pricing">
            <T k="Reset Filters" />
          </Link>
        </Button>
        {children && (
          <div className="flex flex-wrap gap-3 sm:ml-auto">{children}</div>
        )}
      </div>
    </form>
  );
}
