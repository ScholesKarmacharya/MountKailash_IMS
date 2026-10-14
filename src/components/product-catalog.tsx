import { randomUUID } from "node:crypto";
import { Droplets, Package } from "lucide-react";
import type { Product } from "@/domain/inventory/validation";
import { npr } from "@/domain/finance/money";
import { T, Message, Value } from "./localization";
import { Card } from "./ui/card";
import { StatusBadge } from "./ui/status-badge";
import { AdminDialog } from "./admin-dialog";
import { ProductForm } from "./inventory-forms";

export function ProductCatalog({
  products,
  available,
}: {
  products: Product[];
  available: boolean;
}) {
  return (
    <div className="space-y-5" data-testid="products-catalog">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold sm:text-3xl">
            <T k="Products" />
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            <T k="Manage water jars, cartons and product information." />
          </p>
        </div>
        {available && (
          <AdminDialog title="Add Product" triggerLabel="Add Product" primary>
            <ProductForm requestKey={randomUUID()} productId={randomUUID()} />
          </AdminDialog>
        )}
      </div>
      {!available ? (
        <Card className="p-4">
          <p role="status">
            <T k="Products could not be loaded. Refresh the page or contact your administrator." />
          </p>
        </Card>
      ) : !products.length ? (
        <Card className="p-4">
          <T k="No products yet. Add a water jar or carton with your selling price and unit." />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {products.map((product) => {
            const Icon = product.kind === "FULL_JAR" ? Droplets : Package;
            return (
              <Card
                key={product.id}
                className="min-w-0 space-y-3 p-4"
                data-testid={"product-card-" + product.id}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-teal-50 text-primary">
                      <Icon className="size-5" aria-hidden="true" />
                    </span>
                    <div className="min-w-0">
                      <h2 className="break-words font-bold">{product.name}</h2>
                      <p className="mt-1 text-sm text-muted-foreground">
                        <T
                          k={
                            product.kind === "FULL_JAR"
                              ? "20L returnable water jar"
                              : "Bottled-water carton"
                          }
                        />
                      </p>
                    </div>
                  </div>
                  <StatusBadge
                    label={product.is_active ? "Active" : "Inactive"}
                    tone={product.is_active ? "positive" : "neutral"}
                  />
                </div>
                <dl className="grid grid-cols-2 gap-3 border-t border-border pt-3 text-sm">
                  <div className="min-w-0">
                    <dt className="text-muted-foreground">
                      <T k="SKU" />
                    </dt>
                    <dd className="mt-1 break-words font-semibold">
                      {product.sku}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">
                      <T k="Unit" />
                    </dt>
                    <dd className="mt-1 break-words font-semibold">
                      <Message value={product.unit} />
                    </dd>
                  </div>
                </dl>
                <div className="flex flex-wrap items-end justify-between gap-3 border-t border-border pt-3">
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">
                      <T k="Default selling price (NPR)" />
                    </p>
                    <p
                      className="mt-1 break-words text-lg font-bold tabular-nums"
                      data-testid="product-default-price"
                    >
                      <Value value={npr(product.default_price)} />
                      <span className="text-sm font-normal text-muted-foreground">
                        {" "}
                        / <Message value={product.unit} />
                      </span>
                    </p>
                  </div>
                  <AdminDialog
                    title="Edit Product"
                    triggerLabel="Edit Product"
                    context={product.name}
                  >
                    <ProductForm
                      product={product}
                      productId={product.id}
                      requestKey={randomUUID()}
                    />
                  </AdminDialog>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
