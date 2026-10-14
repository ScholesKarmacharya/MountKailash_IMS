import { randomUUID } from "node:crypto";
import { SlidersHorizontal } from "lucide-react";
import { getInventory } from "@/services/inventory";
import { getWarehouseActivity } from "@/services/warehouse-ui";
import { historyRange } from "@/services/history";
import { inventoryHistoryFilter } from "@/domain/inventory/presentation";
import { T, DateValue } from "@/components/localization";
import { Card } from "@/components/ui/card";
import { AdminDialog } from "@/components/admin-dialog";
import { AdjustmentForm, OpenDayForm } from "@/components/inventory-forms";
import { WarehouseStock } from "@/components/warehouse-stock";
import { WarehouseProductStock } from "@/components/warehouse-product-stock";
import { InventoryHistoryFilters } from "@/components/inventory-history-filters";
import {
  StockActivityHistory,
  AdjustmentHistory,
  HistoryPagination,
} from "@/components/inventory-history";
import Link from "next/link";

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  let filter, adjustmentFilter;
  try {
    filter = inventoryHistoryFilter(params);
    adjustmentFilter = inventoryHistoryFilter(params, "adjustment_");
  } catch {
    return (
      <Card>
        <T k="Invalid inventory history filters." />{" "}
        <Link className="text-primary underline" href="/admin/inventory">
          <T k="Reset Filters" />
        </Link>
      </Card>
    );
  }
  const inventory = await getInventory(
    adjustmentFilter.page,
    historyRange(adjustmentFilter.from, adjustmentFilter.to),
    adjustmentFilter,
  );
  const { available, products, balances, adjustments, businessDay, hasMore } =
    inventory;
  const journal = available
    ? await getWarehouseActivity(params)
    : { rows: [], related: [], hasMore: false };
  return (
    <div className="min-w-0 space-y-5" data-testid="inventory-workspace">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold sm:text-3xl">
            <T k="Warehouse inventory" />
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            <T k="View usable warehouse stock and track every authorized stock change." />
          </p>
        </div>
        {available && (
          <AdminDialog
            title="Manual adjustment"
            triggerLabel="Adjust Stock"
            primary
            icon={<SlidersHorizontal className="size-4" aria-hidden="true" />}
          >
            {!businessDay ? (
              <div className="space-y-4">
                <p className="text-sm">
                  <T k="No active business day. Open one before posting stock. Opening uses Nepal time and does not reset any balance. Review and close the day from Daily close." />
                </p>
                <OpenDayForm requestKey={randomUUID()} />
              </div>
            ) : businessDay.status !== "OPEN" ? (
              <p role="status">
                <T
                  k="Business day {0} is in closing review. Stock changes are blocked."
                  values={[
                    <DateValue key="date" value={businessDay.date_label} />,
                  ]}
                />
              </p>
            ) : !products.length ? (
              <p>
                <T k="Create a product first." />
              </p>
            ) : (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  <T
                    k="Posting to business day {0}, even if operations cross midnight."
                    values={[
                      <DateValue key="date" value={businessDay.date_label} />,
                    ]}
                  />
                </p>
                <AdjustmentForm
                  products={products}
                  balances={balances}
                  dayId={businessDay.id}
                  requestKey={randomUUID()}
                />
              </div>
            )}
          </AdminDialog>
        )}
      </div>
      <WarehouseStock balances={balances} available={available} />
      <p className="text-xs text-muted-foreground">
        <T k="Current usable warehouse stock. Vehicle and damaged stock are excluded; history filters do not change these balances." />
      </p>
      {!available ? (
        <Card>
          <p role="status">
            <T k="Inventory is unavailable. Contact your administrator or refresh the page." />
          </p>
        </Card>
      ) : (
        <>
          <Card className="min-w-0 space-y-3 p-4">
            <h2 className="text-lg font-bold">
              <T k="Stock by product" />
            </h2>
            <WarehouseProductStock products={products} balances={balances} />
          </Card>
          <Card className="min-w-0 space-y-4 p-4">
            <h2 className="text-lg font-bold">
              <T k="Stock Activity History" />
            </h2>
            <p className="text-xs text-muted-foreground">
              <T k="Warehouse history includes only transfers to or from the warehouse. Company-wide history also includes vehicle deliveries, collections and reconciliation." />
            </p>
            <InventoryHistoryFilters
              key={JSON.stringify(filter)}
              filter={filter}
              products={products}
              action="/admin/inventory"
              params={params}
            />
            <p className="text-xs text-muted-foreground">
              <T k="Activity dates use Nepal local time. Original posting dates and both refill movements remain in View Details." />
            </p>
            <StockActivityHistory
              rows={journal.rows}
              related={journal.related}
              scope={filter.scope}
            />
            <HistoryPagination
              page={filter.page}
              label="Stock history pages"
              hasMore={journal.hasMore}
              params={params}
              action="/admin/inventory"
            />
          </Card>
          <Card className="min-w-0 space-y-4 p-4">
            <h2 className="text-lg font-bold">
              <T k="Immutable adjustment history" />
            </h2>
            <p className="text-xs text-muted-foreground">
              <T k="Corrections create new audited entries. Existing adjustments cannot be edited or deleted." />
            </p>
            <InventoryHistoryFilters
              key={JSON.stringify(adjustmentFilter)}
              filter={adjustmentFilter}
              products={products}
              prefix="adjustment_"
              mode="adjustment"
              action="/admin/inventory"
              params={params}
            />
            <AdjustmentHistory rows={adjustments} products={products} />
            <HistoryPagination
              page={adjustmentFilter.page}
              label="Adjustment history pages"
              hasMore={hasMore}
              params={params}
              action="/admin/inventory"
              pageName="adjustment_page"
            />
          </Card>
        </>
      )}
    </div>
  );
}
