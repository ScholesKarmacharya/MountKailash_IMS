import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProductDelivery } from "@/domain/operations/product-delivery";

// Read only immutable visit quantities and immutable product kinds, under the
// caller's existing RLS. Chunk filters and paginate to avoid PostgREST row caps.
export async function readProductKinds(client: SupabaseClient, ids: string[]) {
  const products: {
    id: string;
    name: string;
    kind: ProductDelivery["kind"];
  }[] = [];
  const unique = [...new Set(ids)];
  for (let start = 0; start < unique.length; start += 100) {
    const { data, error } = await client
      .from("products")
      .select("id,name,kind")
      .in("id", unique.slice(start, start + 100));
    if (error)
      throw new Error("Product details could not be loaded. Please retry.");
    products.push(...data);
  }
  return products;
}
export async function readProductDeliveries(
  client: SupabaseClient,
  visitIds: string[],
): Promise<ProductDelivery[]> {
  const rows: {
    visit_id: string;
    product_id: string;
    full_jars: number;
    empty_jars: number;
    cartons: number;
  }[] = [];
  const unique = [...new Set(visitIds)];
  for (let start = 0; start < unique.length; start += 100) {
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await client
        .from("visit_items")
        .select("visit_id,product_id,full_jars,empty_jars,cartons")
        .in("visit_id", unique.slice(start, start + 100))
        .order("visit_id")
        .order("product_id")
        .range(offset, offset + 499);
      if (error)
        throw new Error("Delivery details could not be loaded. Please retry.");
      rows.push(...data);
      if (data.length < 500) break;
    }
  }
  const products = await readProductKinds(
    client,
    rows.map((r) => r.product_id),
  );
  return rows.map((row) => {
    const product = products.find((p) => p.id === row.product_id);
    if (!product)
      throw new Error("Product details could not be loaded. Please retry.");
    return { ...row, kind: product.kind, name: product.name };
  });
}
