"use client";
import { useState } from "react";
import type { Count } from "@/domain/operations/types";
import type { Product } from "@/domain/inventory/validation";
import { Counter, Field, OperationForm } from "../operation-form";
import { useLocale } from "../localization";
export function OfflineExceptionForm({
  trip,
  counts,
  products,
  requestKey,
}: {
  trip: string;
  counts: Count[];
  products: Product[];
  requestKey: string;
}) {
  const [physical, setPhysical] = useState(counts),
    { t } = useLocale();
  return (
    <OperationForm
      operation="offline:exception"
      trip={trip}
      requestKey={requestKey}
      label="Record missing-device exception"
      confirm="Unreported device records may still exist. Record this audited exception and physical stock review?"
    >
      <input type="hidden" name="counts" value={JSON.stringify(physical)} />
      {physical.map((c, i) => (
        <Counter
          key={c.product_id + c.stock_kind}
          label={`${products.find((p) => p.id === c.product_id)?.name ?? ""} · ${t(c.stock_kind === "FULL_JAR" ? "Full jars" : c.stock_kind === "EMPTY_JAR" ? "Empty jars" : "Water cartons")}`}
          value={c.quantity}
          onChange={(n) =>
            setPhysical((old) =>
              old.map((v, j) => (i === j ? { ...v, quantity: n } : v)),
            )
          }
        />
      ))}
      <Field
        name="reason"
        label="Physical counts and recovery evidence"
        required
        maxLength={500}
      />
    </OperationForm>
  );
}
