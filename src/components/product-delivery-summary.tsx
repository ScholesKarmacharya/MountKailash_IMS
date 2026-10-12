"use client";
import { T, Value } from "./localization";
import {
  deliveryFields,
  deliveryHeading,
  type ProductDelivery,
} from "@/domain/operations/product-delivery";

export function ProductDeliverySummary({
  line,
  previousBalance,
  aggregate = false,
}: {
  line: ProductDelivery;
  previousBalance?: number;
  aggregate?: boolean;
}) {
  return (
    <section
      aria-label={line.name}
      className="space-y-2 rounded-lg border border-border p-3 text-sm"
    >
      <h4 className="font-semibold">
        <T k={deliveryHeading(line.kind)} />
      </h4>
      <p className="break-words text-muted-foreground">{line.name}</p>
      <dl className="space-y-1">
        {deliveryFields(line).map((field) => (
          <div
            key={field.label}
            className="flex flex-wrap justify-between gap-x-4"
          >
            <dt>
              <T k={field.label} />
              {field.label === "Unreturned Jars" && (
                <>
                  {" "}
                  <span className="text-xs text-muted-foreground">
                    (
                    <T
                      k={
                        aggregate ? "net change" : "net change from this visit"
                      }
                    />
                    )
                  </span>
                </>
              )}
            </dt>
            <dd className="font-semibold">
              <Value value={field.quantity} />
            </dd>
          </div>
        ))}
        {line.kind === "FULL_JAR" && previousBalance !== undefined && (
          <>
            <div className="flex flex-wrap justify-between gap-x-4">
              <dt>
                <T k="Previous unreturned jars" />
              </dt>
              <dd>
                <Value value={previousBalance} />
              </dd>
            </div>
            <div className="flex flex-wrap justify-between gap-x-4">
              <dt>
                <T k="Updated total unreturned jars" />
              </dt>
              <dd className="font-semibold">
                <Value
                  value={previousBalance + line.full_jars - line.empty_jars}
                />
              </dd>
            </div>
          </>
        )}
      </dl>
    </section>
  );
}
