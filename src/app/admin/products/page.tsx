import { randomUUID } from "node:crypto";
import { Card } from "@/components/ui/card";
import { ProductForm } from "@/components/inventory-forms";
import { getInventory } from "@/services/inventory";
export default async function ProductsPage() {
  const { products, available } = await getInventory();
  return (
    <div className="space-y-7">
      <div>
        <h1 className="text-3xl font-bold">Products</h1>
        <p className="mt-2 text-muted-foreground">
          20L water jars and bottled-water cartons. Prices are in NPR; deposits
          and tax are separate future workflows.
        </p>
      </div>
      {!available ? (
        <Card>
          <p role="status">
            Sprint 1 database setup is pending. Apply the reviewed inventory
            migration before creating products.
          </p>
        </Card>
      ) : (
        <>
          <Card>
            <h2 className="mb-5 text-xl font-semibold">New product</h2>
            <ProductForm requestKey={randomUUID()} productId={randomUUID()} />
          </Card>
          {!products.length && (
            <Card>
              No products yet. Create a jar or carton product with your actual
              selling price and unit. No carton pack size or price is assumed.
            </Card>
          )}
          {products.map((product) => (
            <Card key={product.id}>
              <details>
                <summary className="cursor-pointer text-lg font-semibold">
                  {product.name} · {product.sku} ·{" "}
                  {product.is_active ? "Active" : "Inactive"}
                </summary>
                <p className="my-4 text-sm text-muted-foreground">
                  NPR {product.default_price} / {product.unit}. Product kind
                  stays fixed; deactivation preserves stock and history.
                </p>
                <ProductForm
                  product={product}
                  productId={product.id}
                  requestKey={randomUUID()}
                />
              </details>
            </Card>
          ))}
        </>
      )}
    </div>
  );
}
