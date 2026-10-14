"use client";
import Link from "next/link";
import { BsDateRange } from "./bs-date-picker";
import { useLocale, T } from "./localization";
import { Button } from "./ui/button";
import type { Workspace } from "@/domain/operations/types";
export function FinanceFilters({
  workspace: w,
  days,
  filters,
  day,
}: {
  workspace: Pick<Workspace, "customers" | "drivers" | "trips">;
  days: { id: string; date_label: string; status: string }[];
  filters: Record<string, string | undefined>;
  day: string | null;
}) {
  const { t, date, number } = useLocale();
  const fields = [
    {
      name: "day",
      label: "Overview business day",
      options: days.map((d) => [
        d.id,
        `${date(d.date_label)} (${t(d.status.replaceAll("_", " "))})`,
      ]),
    },
    {
      name: "customer",
      label: "Customer",
      options: w.customers.map((c) => [c.id, c.name]),
    },
    {
      name: "driver",
      label: "Driver",
      options: w.drivers.map((d) => [d.id, d.name]),
    },
    {
      name: "trip",
      label: "Trip",
      options: w.trips.map((r) => [
        r.id,
        t("Trip #{0}").replace("{0}", number(r.trip_number)),
      ]),
    },
    {
      name: "method",
      label: "Method",
      options: ["CASH", "FONEPAY"].map((s) => [s, t(s)]),
    },
    {
      name: "status",
      label: "Status",
      options: ["PENDING", "CONFIRMED", "REJECTED", "REVERSED"].map((s) => [
        s,
        t(s),
      ]),
    },
  ];
  return (
    <form aria-label={t("Payment history filters")} className="space-y-4">
      <BsDateRange from={filters.from} to={filters.to} />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {fields.map((field) => (
          <label key={field.name} className="grid gap-2 text-sm font-medium">
            <T k={field.label} />
            <select
              name={field.name}
              aria-label={t(field.label)}
              defaultValue={
                field.name === "day" ? (day ?? "") : (filters[field.name] ?? "")
              }
              className="min-h-12 min-w-0 rounded-lg border border-input bg-background px-3"
            >
              {field.name !== "day" && <option value="">{t("All")}</option>}
              {field.options.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      <div className="flex flex-wrap gap-3">
        <Button type="submit">
          <T k="Filter history" />
        </Button>
        <Button asChild variant="outline">
          <Link href="/admin/payments">
            <T k="Clear filters" />
          </Link>
        </Button>
      </div>
    </form>
  );
}
export function TaxTreatmentField({ value }: { value: string }) {
  const { t } = useLocale();
  return (
    <label className="grid gap-2 text-sm font-medium">
      <T k="Confirmed tax treatment" />
      <select
        name="tax_mode"
        aria-label={t("Confirmed tax treatment")}
        defaultValue={value}
        className="min-h-12 min-w-0 rounded-lg border border-input bg-background px-3"
      >
        <option value="UNCONFIGURED">
          {t("Unconfigured - registration requirements pending")}
        </option>
        <option value="NO_TAX">{t("Confirmed no tax")}</option>
        <option value="EXPLICIT">{t("Confirmed explicit tax rate")}</option>
      </select>
    </label>
  );
}
