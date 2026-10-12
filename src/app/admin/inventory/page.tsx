import { BsDateRange } from "@/components/bs-date-picker";
import { Button } from "@/components/ui/button";
import { getStockHistory, historyRange } from "@/services/history";
import {
  T,
  Message,
  DateValue,
  Value,
  LocalizedNav,
} from "@/components/localization";
import { randomUUID } from "node:crypto";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { AdjustmentForm, OpenDayForm } from "@/components/inventory-forms";
import { WarehouseStock } from "@/components/warehouse-stock";
import { getInventory } from "@/services/inventory";
import { stockLabels } from "@/domain/inventory/validation";

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; from?: string; to?: string }>;
}) {
  const params = await searchParams;
  const page = /^\d{1,4}$/.test(params.page ?? "") ? Number(params.page) : 0;
  const { available, balances, products, adjustments, businessDay, hasMore } =
    await getInventory(page, historyRange(params.from, params.to));
  const journal = available
    ? await getStockHistory(params.from, params.to, page)
    : { rows: [], hasMore: false };
  const pageQuery = (p: number) =>
    "?" + new URLSearchParams({ ...params, page: String(p) });
  const productNames = new Map(
    products.map((p) => [p.id, `${p.name} (${p.sku})`]),
  );
  return (
    <div className="space-y-7">
      <div>
        <h1 className="text-3xl font-bold">
          <T k="Warehouse inventory" />
        </h1>
        <p className="mt-2 text-muted-foreground">
          <T k="Persistent physical stock with permanent, reasoned correction history." />
        </p>
      </div>
      <WarehouseStock balances={balances} available={available} />
      <form className="space-y-3">
        <BsDateRange from={params.from} to={params.to} />
        <Button type="submit">
          <T k="Filter history" />
        </Button>
      </form>
      {!available ? (
        <Card>
          <p role="status">
            <T k="Sprint 1 database setup is pending. No stock quantities are displayed as zero until the migration is applied." />
          </p>
        </Card>
      ) : (
        <>
          <Card>
            <h2 className="mb-4 text-xl font-semibold">
              <T k="Stock by product" />
            </h2>
            {!balances.length ? (
              <p>
                {" "}
                <T k="No products yet." />{" "}
                <Link className="text-primary underline" href="/admin/products">
                  <T k="Create products" />
                </Link>{" "}
                <T k="before posting opening counts." />{" "}
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
                      <Message value={stockLabels[balance.stock_kind]} />
                    </span>
                    <strong>
                      <Value value={balance.quantity} />
                    </strong>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <h2 className="mb-4 text-xl font-semibold">
              <T k="Manual adjustment" />
            </h2>
            {!businessDay ? (
              <div className="space-y-4">
                <p>
                  <T k="No active business day. Open one before posting stock. Opening uses Nepal time and does not reset any balance. Review and close the day from Daily close." />
                </p>
                <OpenDayForm requestKey={randomUUID()} />
              </div>
            ) : businessDay.status !== "OPEN" ? (
              <p role="status">
                <T
                  k="Business day {0} is in closing review. Stock changes are blocked."
                  values={[
                    <DateValue key="v0" value={businessDay.date_label} />,
                  ]}
                />
              </p>
            ) : !products.length ? (
              <p>
                <T k="Create a product first." />
              </p>
            ) : (
              <div className="space-y-4">
                <p className="text-sm">
                  <T
                    k="Posting to business day {0}, even if operations cross midnight."
                    values={[
                      <DateValue key="v0" value={businessDay.date_label} />,
                    ]}
                  />
                </p>
                <AdjustmentForm
                  products={products}
                  dayId={businessDay.id}
                  requestKey={randomUUID()}
                />
              </div>
            )}
          </Card>
          <Card className="space-y-4">
            <h2 className="text-xl font-semibold">
              <T k="Stock movements" />
            </h2>
            <p className="text-sm">
              <T k="Movement dates use Nepal local time. All transfers remain attached to their original business day." />
            </p>
            {!journal.rows.length && (
              <p>
                <T k="No posted stock movements." />
              </p>
            )}
            {journal.rows.map((row) => (
              <div key={row.id} className="border-b py-3 text-sm">
                <p>
                  {productNames.get(row.product_id)} ?{" "}
                  <Message value={row.stock_kind} /> ?{" "}
                  <Value value={row.quantity} />
                </p>
                <p>
                  <Message value={row.movement_type} /> ?{" "}
                  <DateValue value={row.created_at} time />
                </p>
                <p className="break-all">
                  {row.id} · {row.business_day_id} · {row.actor_user_id}
                </p>
              </div>
            ))}
            <LocalizedNav
              className="flex gap-4"
              aria-label="Stock history pages"
            >
              {page > 0 && (
                <Link
                  className="text-primary underline"
                  href={pageQuery(page - 1)}
                >
                  <T k="Newer entries" />
                </Link>
              )}
              {journal.hasMore && (
                <Link
                  className="text-primary underline"
                  href={pageQuery(page + 1)}
                >
                  <T k="Older entries" />
                </Link>
              )}
            </LocalizedNav>
          </Card>
          <Card>
            <h2 className="mb-4 text-xl font-semibold">
              <T k="Immutable adjustment history" />
            </h2>
            <p className="mb-5 text-sm text-muted-foreground">
              <T k="Newest first · 25 entries per page. Corrections require another adjustment; previous entries cannot be edited or deleted." />
            </p>
            {!adjustments.length ? (
              <p>
                <T k="No adjustments on this page." />
              </p>
            ) : (
              <ol className="space-y-4">
                {adjustments.map((entry) => (
                  <li
                    key={entry.id}
                    className="rounded-lg border border-border p-4 text-sm"
                  >
                    <p className="font-semibold">
                      {productNames.get(entry.stock_movements.product_id)} ·{" "}
                      <Message
                        value={stockLabels[entry.stock_movements.stock_kind]}
                      />
                    </p>
                    <p className="mt-2">
                      <T
                        k="{0} {1} · Before {2} → After {3}"
                        values={[
                          entry.delta > 0 ? "+" : "",
                          entry.delta,
                          entry.quantity_before,
                          entry.quantity_after,
                        ]}
                      />
                    </p>
                    <p className="mt-2 break-words">
                      <T k="Reason: {0}" values={[entry.reason]} />
                    </p>
                    {entry.notes && (
                      <p className="mt-1 break-words">
                        <T k="Notes: {0}" values={[entry.notes]} />
                      </p>
                    )}
                    <p className="mt-3 text-muted-foreground">
                      <T
                        k="{0} (Nepal time)"
                        values={[
                          <DateValue key="v0" value={entry.created_at} time />,
                        ]}
                      />
                    </p>
                    <p className="mt-1 break-all text-xs text-muted-foreground">
                      <T
                        k="Actor: {0} · Business day: {1} · Reference: {2}"
                        values={[
                          entry.stock_movements.profiles?.name ??
                            entry.stock_movements.actor_user_id,
                          <DateValue
                            key="v1"
                            value={
                              entry.stock_movements.business_days?.date_label ??
                              entry.stock_movements.business_day_id
                            }
                          />,
                          entry.id,
                        ]}
                      />
                    </p>
                  </li>
                ))}
              </ol>
            )}
            <LocalizedNav
              aria-label="Adjustment history pages"
              className="mt-5 flex gap-5"
            >
              {page > 0 && (
                <Link
                  className="text-primary underline"
                  href={pageQuery(page - 1)}
                >
                  <T k="Newer entries" />
                </Link>
              )}
              {hasMore && (
                <Link
                  className="text-primary underline"
                  href={pageQuery(page + 1)}
                >
                  <T k="Older entries" />
                </Link>
              )}
            </LocalizedNav>
          </Card>
        </>
      )}
    </div>
  );
}
