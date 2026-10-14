import Link from "next/link";
import { randomUUID } from "node:crypto";
import { getHouseWorkspace } from "@/services/house";
import { getOperations } from "@/services/operations";
import { houseFilter, freeSummary } from "@/domain/house/pricing";
import { sum, npr } from "@/domain/finance/money";
import { HouseFilters } from "@/components/house-filters";
import { Card } from "@/components/ui/card";
import { T, Message, DateValue, Value } from "@/components/localization";
import { OperationForm, Field, Select } from "@/components/operation-form";
import { requirePermission } from "@/services/auth";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { ProductPricingList } from "@/components/product-pricing-list";
import { HouseCustomerCards } from "@/components/house-customer-cards";
import {
  FreeSupplyReports,
  FreeDeliveryHistory,
} from "@/components/free-supply-reports";
import { ChevronDown, Download, Plus, ShieldCheck } from "lucide-react";
export default async function PricingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const q = await searchParams;
  await requirePermission("admin:read");
  let filter;
  try {
    filter = houseFilter(q);
  } catch {
    return (
      <Card>
        <T k="Invalid business-date range." />
      </Card>
    );
  }
  const [w, operations] = await Promise.all([
    getHouseWorkspace(q),
    getOperations(true),
  ]);
  if (!w.available)
    return (
      <Card>
        <T k="Apply the reviewed HOUSE migration to enable Pricing & Free Supply." />
      </Card>
    );
  const totals = freeSummary(w.rows),
    adjustment = sum(w.adjustments.map((a) => a.amount));
  const query = new URLSearchParams({
    preset: "custom",
    from: filter.from,
    to: filter.to,
  });
  for (const name of ["customer", "driver", "product"] as const)
    if (filter[name]) query.set(name, filter[name]);
  const day = operations.days.find((d) => d.status === "OPEN");
  return (
    <div className="min-w-0 space-y-5" data-testid="pricing-free-supply">
      <div>
        <h1 className="text-2xl font-bold sm:text-3xl">
          <T k="Pricing & Free Supply" />
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          <T k="Manage selling prices and track approved free water supplies." />
        </p>
      </div>
      <Card className="min-w-0 p-4" data-testid="product-pricing">
        <h2 className="mb-3 text-lg font-bold">
          <T k="Product Pricing" />
        </h2>
        <p className="mb-3 text-xs text-muted-foreground">
          <T k="Reference value only; excluded from revenue and customer credit." />
        </p>
        <ProductPricingList products={w.products} />
        <Link
          className="mt-4 inline-block text-primary underline"
          href="/admin/customers"
        >
          <T k="Manage customer-specific prices" />
        </Link>
      </Card>
      <Card className="min-w-0 p-4" data-testid="house-customers">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-bold">
            <T k="House Customers" />
          </h2>
          <Button asChild variant="outline">
            <Link href="/admin/customers">
              <Plus className="size-4" aria-hidden="true" />
              <T k="Add customer" />
            </Link>
          </Button>
        </div>
        <div className="hidden overflow-x-auto xl:block">
          <table className="min-w-[700px] w-full text-left text-sm">
            <thead className="border-b border-border bg-muted/50 text-xs text-muted-foreground">
              <tr>
                {[
                  "Customer Name",
                  "Phone",
                  "Address",
                  "Approval Status",
                  "Jars Supplied",
                  "Unreturned Jars",
                  "Last Delivery Date",
                ].map((label) => (
                  <th scope="col" className="p-3" key={label}>
                    <T k={label} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {w.customers.map((c) => (
                <tr className="border-t border-border" key={c.id}>
                  <td className="p-3">
                    <Link
                      className="text-primary underline"
                      href={`/admin/customers/${c.id}`}
                    >
                      {c.name}
                    </Link>
                  </td>
                  <td className="p-3">{c.phone}</td>
                  <td className="p-3">{c.address}</td>
                  <td className="p-3">
                    <StatusBadge
                      label={
                        c.house_status === "APPROVED"
                          ? "Approved"
                          : c.house_status === "SUSPENDED"
                            ? "Suspended"
                            : "Approval Required"
                      }
                      tone={
                        c.house_status === "APPROVED" ? "positive" : "warning"
                      }
                    />
                  </td>
                  <td className="p-3">
                    <Value value={c.jars_supplied} />
                  </td>
                  <td className="p-3">
                    <Value value={c.unreturned_jars} />
                  </td>
                  <td className="p-3">
                    {c.last_delivery ? (
                      <DateValue value={c.last_delivery} />
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <HouseCustomerCards customers={w.customers} />
        {!w.customers.length && (
          <p className="mt-3">
            <T k="No HOUSE customers yet." />
          </p>
        )}
      </Card>
      <section className="space-y-3" data-testid="free-supply-overview">
        <h2 className="text-lg font-bold">
          <T k="Free Supply Overview" />
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {[
            ["Total Free Jars", totals.jars],
            ["Total Free Cartons", totals.cartons],
            ["Value of Free Supply", npr(totals.value)],
          ].map(([label, value]) => (
            <Card
              key={String(label)}
              className={
                "min-w-0 p-4 " +
                (label === "Value of Free Supply"
                  ? "col-span-2 sm:col-span-1"
                  : "")
              }
            >
              <p className="text-sm font-medium text-muted-foreground">
                <Message value={String(label)} />
              </p>
              <p
                className="mt-2 break-words text-2xl font-bold tabular-nums text-primary"
                data-testid={String(label)}
              >
                <Value value={value} />
              </p>
            </Card>
          ))}
        </div>
        <p className="text-sm text-muted-foreground">
          <T k="Reference value only. Free supplies are excluded from sales revenue and customer credit." />
        </p>
      </section>
      <Card className="min-w-0 space-y-3 p-4">
        <h2 className="text-lg font-bold">
          <T k="Report Filters" />
        </h2>
        <p className="text-xs text-muted-foreground">
          <T
            k="Reporting period: {0} to {1}"
            values={[
              <DateValue key="from" value={filter.from} />,
              <DateValue key="to" value={filter.to} />,
            ]}
          />
        </p>
        <HouseFilters
          key={filter.preset + query.toString()}
          workspace={w}
          filter={filter}
        >
          <Button asChild variant="outline">
            <Link href={"/api/free-supply/export?" + query + "&format=pdf"}>
              <Download className="size-4" aria-hidden="true" />
              <T k="Download PDF" />
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={"/api/free-supply/export?" + query + "&format=xlsx"}>
              <Download className="size-4" aria-hidden="true" />
              <T k="Download Excel" />
            </Link>
          </Button>
        </HouseFilters>
      </Card>
      <FreeSupplyReports rows={w.rows} />
      <FreeDeliveryHistory rows={w.rows} />
      <Card className="min-w-0 p-4">
        <details
          key={query.toString()}
          className="group"
          data-testid="free-supply-corrections"
        >
          <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded text-lg font-bold focus-visible:outline-2 focus-visible:outline-ring">
            <span className="flex items-center gap-2">
              <ShieldCheck
                className="size-5 shrink-0 text-primary"
                aria-hidden="true"
              />
              <T k="Audited free supply corrections" />
            </span>
            <ChevronDown
              className="size-4 shrink-0 text-muted-foreground group-open:rotate-180"
              aria-hidden="true"
            />
          </summary>
          <div className="space-y-4 border-t border-border pt-3">
            <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
              <T k="Corrections are recorded separately on their posting date. Original delivery snapshots stay unchanged." />
            </p>
            <p>
              <T k="Reference value adjustments" />:{" "}
              <Value value={npr(adjustment)} />
            </p>
            {w.adjustments.map((a) => (
              <div
                className="rounded-lg border border-border p-3 text-sm"
                key={a.id}
              >
                <p>
                  <DateValue value={a.created_at} time /> · {a.customer_name} ·{" "}
                  <Value value={npr(a.amount)} /> · {a.reason}
                </p>
                <p className="mt-1">{a.driver_name}</p>
                <p className="mt-1 break-all text-xs text-muted-foreground">
                  <T k="Original delivery transaction" />: {a.visit_id}
                </p>
              </div>
            ))}
            {day && w.rows.length > 0 && (
              <details className="mt-4">
                <summary className="min-h-11 cursor-pointer">
                  <T k="Post adjustment" />
                </summary>
                <OperationForm
                  operation="house:adjust"
                  requestKey={randomUUID()}
                  label="Post adjustment"
                >
                  <input type="hidden" name="day" value={day.id} />
                  <Select name="visit" label="Free Delivery">
                    {[
                      ...new Map(w.rows.map((r) => [r.visit_id, r])).values(),
                    ].map((r) => (
                      <option key={r.visit_id} value={r.visit_id}>
                        {r.customer_name} ·{" "}
                        <DateValue value={r.occurred_at} time /> ·{" "}
                        <T k="Trip #{0}" values={[r.trip_number]} /> ·{" "}
                        {r.visit_id.slice(0, 8)}
                      </option>
                    ))}
                  </Select>
                  <Select name="direction" label="Adjustment type">
                    <option value="INCREASE">
                      <T k="Increase" />
                    </option>
                    <option value="DECREASE">
                      <T k="Decrease" />
                    </option>
                  </Select>
                  <Field
                    name="amount"
                    label="Reference value adjustment (NPR)"
                    required
                    maxLength={16}
                  />
                  <Field
                    name="reason"
                    label="Reason for correction"
                    required
                    maxLength={500}
                  />
                </OperationForm>
              </details>
            )}
          </div>
        </details>
      </Card>
    </div>
  );
}
