"use client";
import { useState } from "react";
import type { Customer } from "@/domain/operations/types";
import { T, useLocale } from "./localization";
export function HouseCustomerFields({
  customer,
  admin = false,
  compact = false,
}: {
  customer?: Customer;
  admin?: boolean;
  compact?: boolean;
}) {
  const [type, setType] = useState(customer?.supply_type ?? "REGULAR");
  const { t } = useLocale();
  return (
    <div
      className={
        compact ? "grid items-start gap-3 sm:grid-cols-2" : "space-y-3"
      }
    >
      <label className="grid gap-2 text-sm font-semibold">
        <T k="Customer Type" />
        <select
          aria-label={t("Customer Type")}
          name="supply_type"
          className="min-h-12 rounded-lg border bg-card p-3"
          value={type}
          onChange={(e) => setType(e.target.value as "REGULAR" | "HOUSE")}
        >
          <option
            value="REGULAR"
            disabled={!admin && customer?.supply_type === "HOUSE"}
          >
            {t("Regular Customer")}
          </option>
          <option value="HOUSE">{t("HOUSE")}</option>
        </select>
      </label>
      {admin &&
        (type === "HOUSE" ? (
          <label className="grid gap-2 text-sm font-semibold">
            <T k="Approval Status" />
            <select
              aria-label={t("Approval Status")}
              name="house_status"
              defaultValue={
                customer?.house_status === "NONE"
                  ? "PENDING"
                  : (customer?.house_status ?? "PENDING")
              }
              className="min-h-12 rounded-lg border bg-card p-3"
            >
              <option value="PENDING">{t("Approval Required")}</option>
              <option value="APPROVED">{t("Approved")}</option>
              <option value="SUSPENDED">{t("Suspended")}</option>
            </select>
          </label>
        ) : (
          <input type="hidden" name="house_status" value="NONE" />
        ))}
      {type === "HOUSE" && (
        <p
          className={`rounded-lg bg-teal-50 p-3 text-sm ${compact ? "sm:col-span-2" : ""}`}
        >
          <T
            k={
              admin
                ? "Only approved HOUSE customers receive eligible products free."
                : "Admin approval is required before free delivery."
            }
          />
        </p>
      )}
    </div>
  );
}
