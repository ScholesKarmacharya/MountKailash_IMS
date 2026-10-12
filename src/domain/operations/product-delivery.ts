import type { Product } from "@/domain/inventory/validation";
import type { VisitItem } from "./types";
import type { Locale } from "@/domain/localization/locale";
import { tr } from "@/domain/localization/format";

export type ProductDelivery = Pick<
  VisitItem,
  "product_id" | "full_jars" | "empty_jars" | "cartons"
> & {
  kind: Product["kind"];
  name: string;
  visit_id?: string;
};
export const deliveryHeading = (kind: Product["kind"]) =>
  kind === "FULL_JAR" ? "Water Jars" : "Water Cartons";

// A visit's signed custody change is not the customer's total balance. Returns
// can reduce earlier custody; never clamp that reduction to zero.
export function deliveryFields(
  line: Pick<ProductDelivery, "kind" | "full_jars" | "empty_jars" | "cartons">,
) {
  return line.kind === "BOTTLE_CARTON"
    ? [{ label: "Cartons Delivered", quantity: line.cartons }]
    : [
        { label: "Jars Delivered", quantity: line.full_jars },
        { label: "Empty Jars Returned", quantity: line.empty_jars },
        {
          label: "Unreturned Jars",
          quantity: line.full_jars - line.empty_jars,
        },
      ];
}
export function deliveryText(
  line: ProductDelivery,
  locale: Locale = "en",
  aggregate = false,
) {
  return `${tr(locale, deliveryHeading(line.kind))} (${line.name}): ${deliveryFields(
    line,
  )
    .map(
      (f) =>
        `${tr(locale, f.label)}: ${tr(locale, "{0}", [f.quantity])}${f.label === "Unreturned Jars" ? ` (${tr(locale, aggregate ? "net change" : "net change from this visit")})` : ""}`,
    )
    .join(" · ")}`;
}
export function productDeliveries(
  items: (Pick<
    VisitItem,
    "product_id" | "full_jars" | "empty_jars" | "cartons"
  > &
    Partial<Pick<VisitItem, "visit_id">>)[],
  products: Product[],
): ProductDelivery[] {
  return items.flatMap((item) => {
    const product = products.find((p) => p.id === item.product_id);
    return product ? [{ ...item, name: product.name, kind: product.kind }] : [];
  });
}
export function groupDeliveries(items: ProductDelivery[]): ProductDelivery[] {
  const groups = new Map<string, ProductDelivery>();
  for (const item of items) {
    const previous = groups.get(item.product_id);
    groups.set(
      item.product_id,
      previous
        ? {
            ...previous,
            full_jars: previous.full_jars + item.full_jars,
            empty_jars: previous.empty_jars + item.empty_jars,
            cartons: previous.cartons + item.cartons,
          }
        : { ...item },
    );
  }
  return [...groups.values()];
}
