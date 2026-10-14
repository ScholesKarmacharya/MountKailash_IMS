"use client";
import Link from "next/link";
import type { Workspace } from "@/domain/operations/types";
import { tripStatusLabels } from "@/domain/operations/trip-presentation";
import { BsDateRange } from "./bs-date-picker";
import { T, useLocale } from "./localization";
import { Select } from "./operation-form";
import { Button } from "./ui/button";
export function TripHistoryFilters({
  workspace,
  filters,
}: {
  workspace: Pick<Workspace, "drivers" | "vehicles">;
  filters: {
    from?: string;
    to?: string;
    driver?: string;
    vehicle?: string;
    status?: string;
  };
}) {
  const { t } = useLocale();
  return (
    <form className="space-y-4" aria-label={t("Trip history filters")}>
      <BsDateRange from={filters.from} to={filters.to} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Select
          name="driver"
          label="Driver"
          value={filters.driver ?? ""}
          required={false}
        >
          <option value="">{t("All drivers")}</option>
          {workspace.drivers.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </Select>
        <Select
          name="vehicle"
          label="Vehicle"
          value={filters.vehicle ?? ""}
          required={false}
        >
          <option value="">{t("All vehicles")}</option>
          {workspace.vehicles.map((v) => (
            <option key={v.id} value={v.id}>
              {v.plate_number}
            </option>
          ))}
        </Select>
        <Select
          name="status"
          label="Status"
          value={filters.status ?? ""}
          required={false}
        >
          <option value="">{t("All statuses")}</option>
          {Object.entries(tripStatusLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {t(label)}
            </option>
          ))}
          <option value="CANCELLED">{t("Cancelled")}</option>
        </Select>
      </div>
      <div className="flex flex-wrap gap-3">
        <Button type="submit">
          <T k="Filter history" />
        </Button>
        <Button asChild variant="outline">
          <Link href="/admin/trips">
            <T k="Reset filters" />
          </Link>
        </Button>
      </div>
    </form>
  );
}
