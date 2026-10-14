"use client";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { freeGroups } from "@/domain/house/pricing";
import type { FreeDelivery } from "@/domain/house/types";
import { npr } from "@/domain/finance/money";
import { Card } from "./ui/card";
import { T, DateValue, Value, useLocale } from "./localization";

export function FreeSupplyReports({ rows }: { rows: FreeDelivery[] }) {
  const { locale } = useLocale();
  return (
    <div
      className="grid gap-4 xl:grid-cols-2"
      data-testid="free-supply-reports"
    >
      {(
        [
          ["customer", "Free Supply by Customer"],
          ["driver", "Free Supply by Driver"],
          ["date", "Free Supply by BS Date"],
          ["month", "Monthly Free Supply Value"],
        ] as const
      ).map(([dimension, label]) => {
        const groups = freeGroups(rows, dimension, locale);
        return (
          <Card key={dimension} className="min-w-0 p-4">
            <h2 className="mb-3 text-base font-bold">
              <T k={label} />
            </h2>
            {!groups.length ? (
              <p className="text-sm text-muted-foreground">
                <T k="No free deliveries in this range." />
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-border text-xs text-muted-foreground">
                    <tr>
                      <th scope="col" className="pb-2 pr-3">
                        <T
                          k={
                            dimension === "customer"
                              ? "Customer"
                              : dimension === "driver"
                                ? "Driver"
                                : dimension === "month"
                                  ? "BS Month"
                                  : "BS Date"
                          }
                        />
                      </th>
                      <th scope="col" className="pb-2 px-2 text-right">
                        <T k="Jars" />
                      </th>
                      <th scope="col" className="pb-2 px-2 text-right">
                        <T k="Cartons" />
                      </th>
                      <th scope="col" className="pb-2 pl-2 text-right">
                        <T k="Reference Value" />
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {groups.map((group) => (
                      <tr key={group.id}>
                        <td className="py-2.5 pr-3 font-medium">
                          {group.label}
                        </td>
                        <td className="px-2 py-2.5 text-right tabular-nums">
                          <Value value={group.jars} />
                        </td>
                        <td className="px-2 py-2.5 text-right tabular-nums">
                          <Value value={group.cartons} />
                        </td>
                        <td className="whitespace-nowrap py-2.5 pl-2 text-right font-semibold tabular-nums">
                          <Value value={npr(group.value)} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}

export function FreeDeliveryHistory({ rows }: { rows: FreeDelivery[] }) {
  return (
    <Card className="min-w-0 p-4" data-testid="free-delivery-history">
      <h2 className="mb-3 text-lg font-bold">
        <T k="Free Delivery History" />
      </h2>
      {!rows.length ? (
        <p className="text-sm text-muted-foreground">
          <T k="No free deliveries in this range." />
        </p>
      ) : (
        <>
          <div className="hidden overflow-x-auto xl:block">
            <table className="min-w-[900px] w-full text-left text-sm">
              <thead className="border-b border-border bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  {[
                    "BS Date & Time",
                    "Customer",
                    "Driver",
                    "Trip",
                    "Product",
                    "Delivered",
                    "Empty Jars Returned",
                    "Reference Price",
                    "Reference Value",
                  ].map((label, index) => (
                    <th
                      scope="col"
                      key={label}
                      className={
                        "px-3 py-3 " + (index >= 5 ? "text-right" : "")
                      }
                    >
                      <T k={label} />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((row) => (
                  <tr key={row.visit_id + ":" + row.product_id}>
                    <td className="px-3 py-3">
                      <DateValue value={row.occurred_at} time />
                    </td>
                    <td className="px-3 py-3 font-medium">
                      {row.customer_name}
                    </td>
                    <td className="px-3 py-3">{row.driver_name}</td>
                    <td className="px-3 py-3">
                      <Link
                        className="inline-flex min-h-11 items-center rounded font-semibold text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                        href={"/admin/trips/" + row.trip_id}
                      >
                        <T k="Trip #{0}" values={[row.trip_number]} />
                      </Link>
                    </td>
                    <td className="px-3 py-3">{row.product_name}</td>
                    <td className="px-3 py-3 text-right tabular-nums">
                      <Value
                        value={
                          row.kind === "FULL_JAR" ? row.full_jars : row.cartons
                        }
                      />{" "}
                      <T k={row.kind === "FULL_JAR" ? "jars" : "cartons"} />
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">
                      <Value value={row.empty_jars} />
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">
                      <Value value={npr(row.reference_price)} />
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-right font-semibold tabular-nums">
                      <Value value={npr(row.reference_value)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="divide-y divide-border xl:hidden">
            {rows.map((row) => (
              <details
                key={row.visit_id + ":" + row.product_id}
                className="group py-3 first:pt-0"
                data-testid={
                  "free-delivery-" + row.visit_id + "-" + row.product_id
                }
              >
                <summary className="flex min-h-11 cursor-pointer list-none items-start justify-between gap-3 rounded focus-visible:outline-2 focus-visible:outline-ring">
                  <div className="min-w-0">
                    <p className="break-words font-semibold">
                      {row.customer_name}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      <DateValue value={row.occurred_at} time />
                    </p>
                    <p className="mt-1 break-words text-sm">
                      {row.product_name} ·{" "}
                      <Value
                        value={
                          row.kind === "FULL_JAR" ? row.full_jars : row.cartons
                        }
                      />{" "}
                      <T k={row.kind === "FULL_JAR" ? "jars" : "cartons"} />
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-bold tabular-nums">
                      <Value value={npr(row.reference_value)} />
                    </p>
                    <ChevronDown
                      className="ml-auto mt-2 size-4 text-muted-foreground group-open:rotate-180"
                      aria-hidden="true"
                    />
                  </div>
                </summary>
                <dl className="mt-3 grid grid-cols-2 gap-3 rounded-lg bg-muted/50 p-3 text-sm">
                  <div>
                    <dt className="text-xs text-muted-foreground">
                      <T k="Driver" />
                    </dt>
                    <dd className="mt-1">{row.driver_name}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">
                      <T k="Trip" />
                    </dt>
                    <dd>
                      <Link
                        href={"/admin/trips/" + row.trip_id}
                        className="inline-flex min-h-11 items-center text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                      >
                        <T k="Trip #{0}" values={[row.trip_number]} />
                      </Link>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">
                      <T k="Jars Delivered" />
                    </dt>
                    <dd className="mt-1">
                      <Value value={row.full_jars} />
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">
                      <T k="Cartons Delivered" />
                    </dt>
                    <dd className="mt-1">
                      <Value value={row.cartons} />
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">
                      <T k="Empty Jars Returned" />
                    </dt>
                    <dd className="mt-1">
                      <Value value={row.empty_jars} />
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">
                      <T k="Reference Price" />
                    </dt>
                    <dd className="mt-1">
                      <Value value={npr(row.reference_price)} />
                    </dd>
                  </div>
                  <div className="col-span-2">
                    <dt className="text-xs text-muted-foreground">
                      <T k="Original delivery transaction" />
                    </dt>
                    <dd className="mt-1 break-all text-xs">{row.visit_id}</dd>
                  </div>
                </dl>
              </details>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}
