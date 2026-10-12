export type PendingJar = {
  entry_id: string;
  customer_id: string;
  customer_name: string;
  product_id: string;
  product_name: string;
  quantity: number;
  pending: number;
  original_date: string;
  business_date: string;
  source: string;
  driver_name?: string | null;
  trip_number?: number | null;
};
export type PendingJarWorkspace = { available: boolean; rows: PendingJar[] };
