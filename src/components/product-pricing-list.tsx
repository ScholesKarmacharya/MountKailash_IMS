import type { Product } from "@/domain/inventory/validation";
import { npr } from "@/domain/finance/money";
import { T, Message, Value } from "./localization";
import { StatusBadge } from "./ui/status-badge";
import { ProductPricingEditor } from "./product-pricing-editor";

function Active({ product }: { product: Product }) {
  return (
    <StatusBadge
      label={product.is_active ? "Active" : "Inactive"}
      tone={product.is_active ? "positive" : "neutral"}
    />
  );
}
function Eligibility({ product }: { product: Product }) {
  return (
    <StatusBadge
      label={product.house_eligible ? "Eligible" : "Not eligible"}
      tone={product.house_eligible ? "positive" : "neutral"}
    />
  );
}
export function ProductPricingList({ products }: { products: Product[] }) {
  return (
    <>
      <div className="hidden overflow-x-auto xl:block">
        <table className="min-w-[700px] w-full text-left text-sm">
          <thead className="border-b border-border bg-muted/50 text-xs text-muted-foreground">
            <tr>
              {[
                "Product",
                "Default Price",
                "HOUSE Eligibility",
                "Reference Price",
                "Edit Pricing",
              ].map((label, index) => (
                <th
                  scope="col"
                  className={
                    "px-3 py-3 " +
                    (index === 1 || index === 3 ? "text-right" : "")
                  }
                  key={label}
                >
                  <T k={label} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {products.map((product) => (
              <tr
                className="border-t border-border"
                key={product.id}
                data-testid={"pricing-product-" + product.id}
              >
                <td className="p-3">
                  <p className="font-semibold">{product.name}</p>
                  <div className="mt-1">
                    <Active product={product} />
                  </div>
                </td>
                <td className="whitespace-nowrap p-3 text-right tabular-nums">
                  <Value value={npr(product.default_price)} />
                  <p className="mt-1 text-xs text-muted-foreground">
                    / <Message value={product.unit} />
                  </p>
                </td>
                <td className="p-3">
                  <Eligibility product={product} />
                </td>
                <td className="whitespace-nowrap p-3 text-right tabular-nums">
                  <Value
                    value={npr(
                      product.reference_price ?? product.default_price,
                    )}
                  />
                </td>
                <td className="p-3">
                  <ProductPricingEditor product={product} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:hidden">
        {products.map((product) => (
          <article
            className="space-y-3 rounded-lg border border-border p-3"
            key={product.id}
            data-testid={"pricing-product-" + product.id}
          >
            <div className="flex items-start justify-between gap-3">
              <h3 className="min-w-0 break-words font-semibold">
                {product.name}
              </h3>
              <Active product={product} />
            </div>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div className="min-w-0">
                <dt className="text-xs text-muted-foreground">
                  <T k="Default Price" />
                </dt>
                <dd className="mt-1 break-words font-semibold tabular-nums">
                  <Value value={npr(product.default_price)} />
                  <span className="font-normal text-muted-foreground">
                    {" "}
                    / <Message value={product.unit} />
                  </span>
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-xs text-muted-foreground">
                  <T k="Reference Price" />
                </dt>
                <dd className="mt-1 break-words font-semibold tabular-nums">
                  <Value
                    value={npr(
                      product.reference_price ?? product.default_price,
                    )}
                  />
                </dd>
              </div>
            </dl>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Eligibility product={product} />
              <ProductPricingEditor product={product} />
            </div>
          </article>
        ))}
      </div>
    </>
  );
}
