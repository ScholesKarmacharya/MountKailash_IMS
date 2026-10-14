import { randomUUID } from "node:crypto";
import Link from "next/link";
import { Recycle, TriangleAlert } from "lucide-react";
import { getInventory } from "@/services/inventory";
import {
  getWarehouseDamage,
  getProcessingHistory,
} from "@/services/warehouse-ui";
import { inventoryHistoryFilter } from "@/domain/inventory/presentation";
import { Card } from "@/components/ui/card";
import { T, Message, DateValue } from "@/components/localization";
import { ProcessingForm } from "@/components/day-forms";
import { InventoryHistoryFilters } from "@/components/inventory-history-filters";
import {
  ProcessingHistory,
  HistoryPagination,
} from "@/components/inventory-history";

export default async function Refilling({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  let filter;
  try {
    filter = inventoryHistoryFilter(params);
  } catch {
    return (
      <Card>
        <T k="Invalid inventory history filters." />{" "}
        <Link className="text-primary underline" href="/admin/refilling">
          <T k="Reset Filters" />
        </Link>
      </Card>
    );
  }
  const inventory = await getInventory();
  if (!inventory.available)
    return (
      <Card>
        <T k="Inventory is unavailable. Contact your administrator or refresh the page." />
      </Card>
    );
  const [damaged, history] = await Promise.all([
    getWarehouseDamage(),
    getProcessingHistory(params),
  ]);
  const day = inventory.businessDay;
  if (!history.available)
    return (
      <Card>
        <p role="status">
          <T k="Warehouse processing is unavailable. Contact your administrator." />
        </p>
      </Card>
    );
  return (
    <div className="min-w-0 space-y-5" data-testid="processing-workspace">
      <div>
        <h1 className="text-2xl font-bold sm:text-3xl">
          <T k="Refilling and damaged jars" />
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          <T k="Record completed refills and inspected damage with clear stock previews." />
        </p>
      </div>
      {day?.status !== "OPEN" ? (
        <Card className="p-4">
          <T k="An OPEN business day is required." />{" "}
          <Link className="text-primary underline" href="/admin/daily-close">
            <T k="Review business day" />
          </Link>
        </Card>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            <T k="Posting Business Day" />: <DateValue value={day.date_label} />
          </p>
          <div className="grid items-start gap-4 xl:grid-cols-2">
            {(["REFILL", "DAMAGE"] as const).map((operation) => (
              <Card
                key={operation}
                className="min-w-0 space-y-4 p-4"
                data-testid={"processing-form-" + operation}
              >
                <h2 className="flex items-center gap-2 text-lg font-bold">
                  {operation === "REFILL" ? (
                    <Recycle
                      className="size-5 shrink-0 text-primary"
                      aria-hidden="true"
                    />
                  ) : (
                    <TriangleAlert
                      className="size-5 shrink-0 text-primary"
                      aria-hidden="true"
                    />
                  )}
                  <Message
                    value={
                      operation === "REFILL"
                        ? "Completed refill batch"
                        : "Damaged jar inspection"
                    }
                  />
                </h2>
                <ProcessingForm
                  day={day.id}
                  products={inventory.products}
                  balances={inventory.balances}
                  damaged={damaged}
                  operation={operation}
                  requestKey={randomUUID()}
                />
              </Card>
            ))}
          </div>
        </>
      )}
      <Card className="min-w-0 space-y-4 p-4">
        <h2 className="text-lg font-bold">
          <T k="Processing history" />
        </h2>
        <p className="text-xs text-muted-foreground">
          <T k="History filters use the posting business day. Available stock always shows current usable warehouse balances." />
        </p>
        <InventoryHistoryFilters
          key={JSON.stringify(filter)}
          filter={filter}
          products={inventory.products}
          mode="processing"
          action="/admin/refilling"
          params={params}
        />
        <ProcessingHistory rows={history.rows} />
        <HistoryPagination
          page={filter.page}
          hasMore={history.hasMore}
          params={params}
          action="/admin/refilling"
        />
        {day && (
          <Link
            className="inline-flex min-h-11 items-center text-sm font-semibold text-primary hover:underline"
            href={"/admin/reports/" + day.id}
          >
            <T k="View stock and audit report" />
          </Link>
        )}
      </Card>
    </div>
  );
}
