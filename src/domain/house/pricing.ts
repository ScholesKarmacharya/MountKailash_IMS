import type { Customer } from "@/domain/operations/types";
import type { Product } from "@/domain/inventory/validation";
import { sum } from "@/domain/finance/money";
import {
  adToBs,
  canonicalDate,
  canonicalRange,
  presetRange,
  formatBusinessDate,
  months,
} from "@/domain/localization/calendar";
import { digits, type Locale } from "@/domain/localization/locale";
import { uuid } from "@/domain/inventory/validation";
import type { FreeDelivery } from "./types";
export function approvedHouse(customer?: Customer | null) {
  return (
    customer?.supply_type === "HOUSE" &&
    customer.house_status === "APPROVED" &&
    customer.is_active
  );
}
export function freeProduct(
  customer: Customer | null | undefined,
  product: Pick<Product, "house_eligible">,
) {
  return approvedHouse(customer) && product.house_eligible === true;
}
export function houseFilter(
  params: Record<string, string | undefined>,
  now = new Date(),
) {
  const preset = params.preset ?? "month";
  if (!["today", "month", "custom"].includes(preset))
    throw new Error("Invalid business-date range.");
  const range =
    preset === "custom"
      ? canonicalRange(params.from ?? "", params.to ?? "")
      : presetRange(preset as "today" | "month", now);
  return {
    preset,
    ...range,
    customer: params.customer ? uuid(params.customer) : null,
    driver: params.driver ? uuid(params.driver) : null,
    product: params.product ? uuid(params.product) : null,
  };
}
export function freeSummary(rows: FreeDelivery[]) {
  return {
    jars: rows.reduce((n, r) => n + r.full_jars, 0),
    cartons: rows.reduce((n, r) => n + r.cartons, 0),
    value: sum(rows.map((r) => r.reference_value)),
  };
}
export function freeGroups(
  rows: FreeDelivery[],
  dimension: "customer" | "driver" | "date" | "month",
  locale: Locale = "en",
) {
  const groups = new Map<string, FreeDelivery[]>();
  for (const row of rows) {
    const bs = adToBs(canonicalDate(row.occurred_at));
    const label =
      dimension === "customer"
        ? row.customer_name
        : dimension === "driver"
          ? row.driver_name
          : dimension === "date"
            ? formatBusinessDate(row.occurred_at, locale)
            : `${bs.year}-${String(bs.month).padStart(2, "0")} BS`;
    // IDs keep equally named customers/drivers separate.
    const id =
      dimension === "customer"
        ? row.customer_id
        : dimension === "driver"
          ? row.driver_id
          : label;
    groups.set(id, [...(groups.get(id) ?? []), row]);
  }
  return [...groups.entries()].map(([id, group]) => ({
    id,
    label:
      dimension === "customer"
        ? group[0]!.customer_name
        : dimension === "driver"
          ? group[0]!.driver_name
          : dimension === "date"
            ? formatBusinessDate(group[0]!.occurred_at, locale)
            : (() => {
                const bs = adToBs(canonicalDate(group[0]!.occurred_at));
                return `${months[locale][bs.month - 1]} ${digits(bs.year, locale)}`;
              })(),
    ...freeSummary(group),
  }));
}
