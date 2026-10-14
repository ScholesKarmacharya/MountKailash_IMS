import { ProductCatalog } from "@/components/product-catalog";
import { getInventory } from "@/services/inventory";
export default async function ProductsPage() {
  const { products, available } = await getInventory();
  return <ProductCatalog products={products} available={available} />;
}
