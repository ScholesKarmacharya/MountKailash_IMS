import { T, Message } from "@/components/localization";
import { randomUUID } from "node:crypto";
import { Card } from "@/components/ui/card";
import { ProductForm } from "@/components/inventory-forms";
import { getInventory } from "@/services/inventory";
export default async function ProductsPage() {
  const { products, available } = await getInventory();
  return (
    <div className="space-y-7">
      <div>
        <h1 className="text-3xl font-bold">
          <T k="Products" />
        </h1>
        <p className="mt-2 text-muted-foreground">
          <T k="20L water jars and bottled-water cartons. Prices are in NPR; deposits and tax are separate future workflows." />
        </p>
      </div>
      {!available ? (
        <Card>
          <p role="status">
            <T k="Sprint 1 database setup is pending. Apply the reviewed inventory migration before creating products." />
          </p>
        </Card>
      ) : (
        <>
          <Card>
            <h2 className="mb-5 text-xl font-semibold">
              <T k="New product" />
            </h2>
            <ProductForm requestKey={randomUUID()} productId={randomUUID()} />
          </Card>
          {!products.length && (
            <Card>
              <T k="No products yet. Create a jar or carton product with your actual selling price and unit. No carton pack size or price is assumed." />
            </Card>
          )}
          {products.map((product) => (
            <Card key={product.id}>
              <details>
                <summary className="cursor-pointer text-lg font-semibold">
                  {product.name} · {product.sku} ·{" "}
                  <Message value={product.is_active ? "Active" : "Inactive"} />
                </summary>
                <p className="my-4 text-sm text-muted-foreground">
                  <T
                    k="NPR {0} / {1}. Product kind stays fixed; deactivation preserves stock and history."
                    values={[
                      product.default_price,
                      <Message key="v1" value={product.unit} />,
                    ]}
                  />
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
