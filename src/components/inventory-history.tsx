import Link from "next/link";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  SlidersHorizontal,
  Recycle,
  TriangleAlert,
  Truck,
  Droplets,
  ChevronDown,
} from "lucide-react";
import { T, Message, Value, DateValue, LocalizedNav } from "./localization";
import { Button } from "./ui/button";
import type { Product } from "@/domain/inventory/validation";
import { stockLabels } from "@/domain/inventory/validation";
import type { Adjustment } from "@/data-access/inventory";
import type { ProcessingRecord } from "@/data-access/warehouse-ui";
import {
  inventoryActivity,
  type MovementRecord,
} from "@/domain/inventory/presentation";

export function HistoryPagination({
  page,
  hasMore,
  params,
  action,
  pageName = "page",
  label = "History Pages",
}: {
  page: number;
  hasMore: boolean;
  params: Record<string, string | undefined>;
  action: string;
  pageName?: string;
  label?: string;
}) {
  const href = (next: number) => {
    const query = new URLSearchParams(
      Object.entries(params).filter(
        (entry): entry is [string, string] => entry[1] !== undefined,
      ),
    );
    query.set(pageName, String(next));
    return action + "?" + query;
  };
  return (
    <LocalizedNav
      aria-label={label}
      className="mt-4 flex flex-wrap items-center gap-3"
    >
      {page > 0 && (
        <Button asChild variant="outline">
          <Link href={href(page - 1)}>
            <T k="Newer entries" />
          </Link>
        </Button>
      )}
      <span className="text-xs text-muted-foreground">
        <T k="Page {0}" values={[page + 1]} />
      </span>
      {hasMore && (
        <Button asChild variant="outline">
          <Link href={href(page + 1)}>
            <T k="Older entries" />
          </Link>
        </Button>
      )}
    </LocalizedNav>
  );
}
function AuditDetails({
  record,
  movements,
}: {
  record?: unknown;
  movements?: unknown[];
}) {
  return (
    <details className="group mt-2">
      <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-2 rounded text-sm font-semibold text-primary focus-visible:outline-2 focus-visible:outline-ring">
        <T k="View Details" />
        <ChevronDown
          className="size-4 group-open:rotate-180"
          aria-hidden="true"
        />
      </summary>
      <div className="min-w-0 space-y-3 rounded-lg bg-muted/50 p-3 text-xs">
        <p>
          <T k="Original Audit References" />
        </p>
        {record !== undefined && (
          <pre className="whitespace-pre-wrap break-all">
            {JSON.stringify(record, null, 2)}
          </pre>
        )}
        {movements?.map((movement, index) => (
          <div key={index}>
            <p className="mb-1 font-semibold">
              <T k="Original Movement {0}" values={[index + 1]} />
            </p>
            <pre className="whitespace-pre-wrap break-all">
              {JSON.stringify(movement, null, 2)}
            </pre>
          </div>
        ))}
      </div>
    </details>
  );
}
export function StockActivityHistory({
  rows,
  related,
  scope,
}: {
  rows: MovementRecord[];
  related: MovementRecord[];
  scope: "warehouse" | "company";
}) {
  return (
    <div
      className="divide-y divide-border"
      data-testid="stock-activity-history"
    >
      {!rows.length && (
        <p className="py-4 text-sm text-muted-foreground">
          <T k="No Stock Activity Matches These Filters." />
        </p>
      )}
      {rows.map((row) => {
        const activity = inventoryActivity(row, related);
        const Icon = activity.grouped
          ? Recycle
          : row.movement_type === "WAREHOUSE_DAMAGE"
            ? TriangleAlert
            : row.movement_type.startsWith("MANUAL_")
              ? SlidersHorizontal
              : row.movement_type === "EMPTY_COLLECTION"
                ? Droplets
                : row.movement_type === "TRIP_LOAD"
                  ? Truck
                  : row.to_location_id
                    ? ArrowDownToLine
                    : ArrowUpFromLine;
        const from =
          row.from_location?.name ??
          (row.movement_type === "EMPTY_COLLECTION"
            ? "Customer"
            : row.movement_type === "REFILL_OUTPUT"
              ? "Refilling"
              : "Outside Stock");
        const to =
          row.to_location?.name ??
          (row.movement_type === "DELIVERY"
            ? "Customer"
            : row.movement_type === "REFILL_INPUT"
              ? "Refilling"
              : "Outside Stock");
        return (
          <article
            key={row.id}
            className="min-w-0 py-4 first:pt-1"
            data-testid={"stock-activity-" + row.id}
          >
            <div className="flex items-start gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-teal-50 text-primary">
                <Icon className="size-5" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h3 className="font-semibold">
                      <Message value={activity.label} />
                    </h3>
                    <p className="mt-1 break-words text-sm">
                      {row.product?.name ?? <T k="Product unavailable" />}
                    </p>
                  </div>
                  <p className="font-bold tabular-nums">
                    <Value value={row.quantity} />{" "}
                    <Message value={row.product?.unit ?? ""} />
                  </p>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {activity.grouped ? (
                    <>
                      <T k="Empty jars" /> → <T k="Full jars" />
                    </>
                  ) : (
                    <Message value={stockLabels[row.stock_kind]} />
                  )}
                  {scope === "company" && (
                    <>
                      {" "}
                      · <T k="Company-wide Stock Activity" />
                    </>
                  )}
                </p>
                <p className="mt-2 break-words text-sm">
                  {activity.grouped ? (
                    <T k="Warehouse Empties → Warehouse Full Jars" />
                  ) : (
                    <>
                      <Message value={from} /> → <Message value={to} />
                    </>
                  )}
                </p>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span>
                    {row.actor?.name ?? <T k="Responsible User Unavailable" />}
                  </span>
                  <DateValue value={row.created_at} time />
                </div>
                {row.trip_id && (
                  <Link
                    className="mt-1 inline-flex min-h-11 items-center text-sm font-semibold text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                    href={"/admin/trips/" + row.trip_id}
                  >
                    <T k="Trip #{0}" values={[row.trip?.trip_number ?? "—"]} />
                  </Link>
                )}
                <AuditDetails movements={activity.movements} />
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}
export function AdjustmentHistory({
  rows,
  products,
}: {
  rows: Adjustment[];
  products: Product[];
}) {
  return (
    <div className="divide-y divide-border" data-testid="adjustment-history">
      {!rows.length && (
        <p className="py-4 text-sm text-muted-foreground">
          <T k="No adjustments on this page." />
        </p>
      )}
      {rows.map((row) => {
        const product = products.find(
          (p) => p.id === row.stock_movements.product_id,
        );
        return (
          <article
            key={row.id}
            className="min-w-0 py-4 first:pt-1"
            data-testid={"adjustment-" + row.id}
          >
            <div className="flex flex-wrap justify-between gap-2">
              <div>
                <h3 className="font-semibold">{product?.name}</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  <Message
                    value={stockLabels[row.stock_movements.stock_kind]}
                  />
                </p>
              </div>
              <p className="font-bold tabular-nums">
                {row.delta > 0 ? "+" : ""}
                <Value value={row.delta} />{" "}
                <Message value={product?.unit ?? ""} />
              </p>
            </div>
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm">
              <span>
                <T k="Before" />: <Value value={row.quantity_before} />
              </span>
              <span>
                <T k="After" />: <Value value={row.quantity_after} />
              </span>
            </div>
            <p className="mt-2 break-words text-sm">
              <T k="Reason: {0}" values={[row.reason]} />
            </p>
            {row.notes && (
              <p className="mt-1 break-words text-sm text-muted-foreground">
                <T k="Notes: {0}" values={[row.notes]} />
              </p>
            )}
            <div className="mt-2 flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
              <span>
                {row.stock_movements.profiles?.name ?? (
                  <T k="Responsible User Unavailable" />
                )}
              </span>
              <DateValue value={row.created_at} time />
            </div>
            <AuditDetails record={row} />
          </article>
        );
      })}
    </div>
  );
}
export function ProcessingHistory({ rows }: { rows: ProcessingRecord[] }) {
  return (
    <div className="divide-y divide-border" data-testid="processing-history">
      {!rows.length && (
        <p className="py-4 text-sm text-muted-foreground">
          <T k="No processing matches these dates." />
        </p>
      )}
      {rows.map((row) => {
        const Icon = row.operation === "REFILL" ? Recycle : TriangleAlert;
        return (
          <article
            key={row.id}
            className="min-w-0 py-4 first:pt-1"
            data-testid={"processing-" + row.id}
          >
            <div className="flex items-start gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-teal-50 text-primary">
                <Icon className="size-5" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap justify-between gap-2">
                  <div>
                    <h3 className="font-semibold">
                      <Message
                        value={
                          row.operation === "REFILL"
                            ? "Completed Refill"
                            : "Damaged Jars Recorded"
                        }
                      />
                    </h3>
                    <p className="mt-1 break-words text-sm">
                      {row.product.name}
                    </p>
                  </div>
                  <p className="font-bold tabular-nums">
                    <Value value={row.quantity} />{" "}
                    <Message value={row.product.unit} />
                  </p>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  <Message value={stockLabels[row.stock_kind]} />
                  {row.operation === "REFILL" && (
                    <>
                      {" "}
                      → <T k="Full jars" />
                    </>
                  )}
                </p>
                <p className="mt-2 break-words text-sm">
                  <T k="Reason: {0}" values={[row.reason]} />
                </p>
                <div className="mt-2 flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
                  <span>{row.actor.name}</span>
                  <DateValue value={row.created_at} time />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  <T k="Posting Business Day" />:{" "}
                  <DateValue value={row.business_days.date_label} />
                </p>
                <AuditDetails
                  record={{ ...row, movements: undefined }}
                  movements={row.movements}
                />
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}
