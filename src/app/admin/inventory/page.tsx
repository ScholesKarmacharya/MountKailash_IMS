import { randomUUID } from "node:crypto";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { AdjustmentForm, OpenDayForm } from "@/components/inventory-forms";
import { WarehouseStock } from "@/components/warehouse-stock";
import { getInventory } from "@/services/inventory";
import { stockLabels } from "@/domain/inventory/validation";
import { formatNepalTime } from "@/domain/business-days/time";
export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const params = await searchParams;
  const page = /^\d{1,4}$/.test(params.page ?? "") ? Number(params.page) : 0;
  const { available, balances, products, adjustments, businessDay, hasMore } =
    await getInventory(page);
  const productNames = new Map(
    products.map((p) => [p.id, `${p.name} (${p.sku})`]),
  );
  return (
    <div className="space-y-7">
      <div>
        <h1 className="text-3xl font-bold">Warehouse inventory</h1>
        <p className="mt-2 text-muted-foreground">
          Persistent physical stock with permanent, reasoned correction history.
        </p>
      </div>
      <WarehouseStock balances={balances} available={available} />
      {!available ? (
        <Card>
          <p role="status">
            Sprint 1 database setup is pending. No stock quantities are
            displayed as zero until the migration is applied.
          </p>
        </Card>
      ) : (
        <>
          <Card>
            <h2 className="mb-4 text-xl font-semibold">Stock by product</h2>
            {!balances.length ? (
              <p>
                No products yet.{" "}
                <Link className="text-primary underline" href="/admin/products">
                  Create products
                </Link>{" "}
                before posting opening counts.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {balances.map((balance) => (
                  <li
                    key={`${balance.product_id}-${balance.stock_kind}`}
                    className="flex flex-wrap justify-between gap-3 py-3"
                  >
                    <span>
                      {productNames.get(balance.product_id)} ·{" "}
                      {stockLabels[balance.stock_kind]}
                    </span>
                    <strong>{balance.quantity.toLocaleString("en-NP")}</strong>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <h2 className="mb-4 text-xl font-semibold">Manual adjustment</h2>
            {!businessDay ? (
              <div className="space-y-4">
                <p>
                  No active business day. Open one before posting stock. Opening
                  uses Nepal time and does not reset any balance. Closing
                  arrives in Sprint 4.
                </p>
                <OpenDayForm requestKey={randomUUID()} />
              </div>
            ) : businessDay.status !== "OPEN" ? (
              <p role="status">
                Business day {businessDay.date_label} is in closing review.
                Stock changes are blocked.
              </p>
            ) : !products.length ? (
              <p>Create a product first.</p>
            ) : (
              <div className="space-y-4">
                <p className="text-sm">
                  Posting to business day {businessDay.date_label}, even if
                  operations cross midnight.
                </p>
                <AdjustmentForm
                  products={products}
                  dayId={businessDay.id}
                  requestKey={randomUUID()}
                />
              </div>
            )}
          </Card>
          <Card>
            <h2 className="mb-4 text-xl font-semibold">
              Immutable adjustment history
            </h2>
            <p className="mb-5 text-sm text-muted-foreground">
              Newest first · 25 entries per page. Corrections require another
              adjustment; previous entries cannot be edited or deleted.
            </p>
            {!adjustments.length ? (
              <p>No adjustments on this page.</p>
            ) : (
              <ol className="space-y-4">
                {adjustments.map((entry) => (
                  <li
                    key={entry.id}
                    className="rounded-lg border border-border p-4 text-sm"
                  >
                    <p className="font-semibold">
                      {productNames.get(entry.stock_movements.product_id)} ·{" "}
                      {stockLabels[entry.stock_movements.stock_kind]}
                    </p>
                    <p className="mt-2">
                      {entry.delta > 0 ? "+" : ""}
                      {entry.delta} · Before {entry.quantity_before} → After{" "}
                      {entry.quantity_after}
                    </p>
                    <p className="mt-2 break-words">Reason: {entry.reason}</p>
                    {entry.notes && (
                      <p className="mt-1 break-words">Notes: {entry.notes}</p>
                    )}
                    <p className="mt-3 text-muted-foreground">
                      {formatNepalTime(entry.created_at)} (Nepal time)
                    </p>
                    <p className="mt-1 break-all text-xs text-muted-foreground">
                      Actor:{" "}
                      {entry.stock_movements.profiles?.name ??
                        entry.stock_movements.actor_user_id}{" "}
                      · Business day:{" "}
                      {entry.stock_movements.business_days?.date_label ??
                        entry.stock_movements.business_day_id}{" "}
                      · Reference: {entry.id}
                    </p>
                  </li>
                ))}
              </ol>
            )}
            <nav
              aria-label="Adjustment history pages"
              className="mt-5 flex gap-5"
            >
              {page > 0 && (
                <Link
                  className="text-primary underline"
                  href={`?page=${page - 1}`}
                >
                  Newer entries
                </Link>
              )}
              {hasMore && (
                <Link
                  className="text-primary underline"
                  href={`?page=${page + 1}`}
                >
                  Older entries
                </Link>
              )}
            </nav>
          </Card>
        </>
      )}
    </div>
  );
}
