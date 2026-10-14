import type { Customer } from "@/domain/operations/types";
import type { Product } from "@/domain/inventory/validation";
export type FreeDelivery = {
  visit_id: string;
  customer_id: string;
  customer_name: string;
  driver_id: string;
  driver_name: string;
  trip_id: string;
  trip_number: number;
  occurred_at: string;
  business_date: string;
  product_id: string;
  product_name: string;
  kind: "FULL_JAR" | "BOTTLE_CARTON";
  full_jars: number;
  empty_jars: number;
  cartons: number;
  reference_price: string;
  reference_value: string;
};
export type HouseWorkspace = {
  available: boolean;
  products: Product[];
  customers: (Customer & {
    jars_supplied: number;
    unreturned_jars: number;
    last_delivery: string | null;
  })[];
  drivers: { id: string; name: string }[];
  rows: FreeDelivery[];
  adjustments: {
    id: string;
    visit_id: string;
    amount: string;
    reason: string;
    created_at: string;
    customer_name: string;
    driver_name: string;
  }[];
};
