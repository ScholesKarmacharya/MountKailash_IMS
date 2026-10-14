import type { Product } from "@/domain/inventory/validation";
import type { Balance } from "@/data-access/inventory";
import { availableStock } from "@/domain/inventory/presentation";
import { T, Message, Value } from "./localization";
import { StatusBadge } from "./ui/status-badge";
export function WarehouseProductStock({
  products,
  balances,
}: {
  products: Product[];
  balances: Balance[];
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {products.map((product) => (
        <article
          key={product.id}
          className="min-w-0 space-y-3 rounded-lg border border-border p-3"
          data-testid={"warehouse-product-" + product.id}
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <h3 className="min-w-0 break-words font-semibold">
              {product.name}
            </h3>
            <StatusBadge
              label={product.is_active ? "Active" : "Inactive"}
              tone={product.is_active ? "positive" : "neutral"}
            />
          </div>
          <p className="break-words text-xs text-muted-foreground">
            <T k="SKU" />: {product.sku} · <T k="Unit" />:{" "}
            <Message value={product.unit} />
          </p>
          <dl className="grid grid-cols-2 gap-3">
            {(product.kind === "FULL_JAR"
              ? ([
                  ["FULL_JAR", "Full jars"],
                  ["EMPTY_JAR", "Empty jars"],
                ] as const)
              : ([["BOTTLE_CARTON", "Water cartons"]] as const)
            ).map(([kind, label]) => (
              <div key={kind}>
                <dt className="text-xs text-muted-foreground">
                  <Message value={label} />
                </dt>
                <dd className="mt-1 font-bold tabular-nums">
                  <Value value={availableStock(balances, product.id, kind)} />
                </dd>
              </div>
            ))}
          </dl>
        </article>
      ))}
      {!products.length && (
        <p className="text-sm text-muted-foreground">
          <T k="No products yet." />
        </p>
      )}
    </div>
  );
}
