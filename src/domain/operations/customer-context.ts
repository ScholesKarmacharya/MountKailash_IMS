import type { Customer, Workspace } from "./types";
import type { Billing, Credit, Price } from "@/domain/finance/types";
import type { PendingJar } from "./pending-jars";
export type DeliveryCustomerContext = {
  house_products?: {
    id: string;
    house_eligible: boolean;
    reference_price: string;
    house_version: number;
  }[];
  free_deliveries?: import("@/domain/house/types").FreeDelivery[];
  pending_jars?: PendingJar[];
  jar_allocations?: {
    return_entry_id: string;
    delivery_entry_id: string;
    product_id: string;
    original_date: string;
    returned_at: string;
    source: string;
    quantity: number;
  }[];
  customer: Customer;
  billing: Billing | null;
  prices: Price[];
  credit: Credit[];
  custody: Workspace["custody"];
  custody_history: {
    id: string;
    product_id: string;
    delta: number;
    resulting_balance: number;
    reason: string;
    created_at: string;
  }[];
  credit_history: {
    id: string;
    kind: string;
    amount: string;
    created_at: string;
    business_day_id: string;
  }[];
};
