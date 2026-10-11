import type { Product, StockKind } from "@/domain/inventory/validation";
export type Customer = {
  id: string;
  name: string;
  shop_name: string;
  phone: string;
  address: string;
  notes: string;
  is_active: boolean;
  version: number;
};
export type Vehicle = {
  id: string;
  plate_number: string;
  description: string;
  location_id: string;
  is_active: boolean;
  version: number;
};
export type Driver = {
  id: string;
  name: string;
  is_active: boolean;
  version: number;
};
export type TripStatus =
  | "DRAFT"
  | "LOADED"
  | "ACTIVE"
  | "SUBMITTED"
  | "UNDER_REVIEW"
  | "CLOSED"
  | "DISCREPANCY";
export type Trip = {
  id: string;
  trip_number: number;
  driver_id: string;
  driver_name: string;
  vehicle_id: string;
  plate_number: string;
  business_day_id: string;
  date_label: string;
  status: TripStatus;
  notes: string;
  created_at: string;
  close_reason: string;
};
export type Count = {
  product_id: string;
  stock_kind: StockKind;
  quantity: number;
};
export type Balance = Count & { location_id: string };
export type VisitItem = {
  visit_id: string;
  product_id: string;
  full_jars: number;
  empty_jars: number;
  cartons: number;
  unit_price_snapshot: string;
};
export type Visit = {
  id: string;
  customer_id: string | null;
  walk_in_name: string;
  walk_in_phone: string;
  notes: string;
  created_at: string;
  value_snapshot: string;
};
export type Workspace = {
  available: boolean;
  customers: Customer[];
  vehicles: Vehicle[];
  drivers: Driver[];
  products: Product[];
  locations: { id: string; code: string; kind: string }[];
  balances: Balance[];
  custody: { customer_id: string; product_id: string; quantity: number }[];
  days: { id: string; date_label: string; status: string }[];
  trips: Trip[];
  loads: (Count & { trip_id: string })[];
  route: { trip_id: string; customer_id: string }[];
  visits: Visit[];
  items: VisitItem[];
  payments: {
    visit_id: string;
    selection: string;
    reported_amount: string | null;
    reference: string;
    settlement_state: string;
  }[];
  declarations: Count[];
  checks: { id: string; outcome: string; reason: string; created_at: string }[];
  movements: {
    id: string;
    movement_type: string;
    product_id: string;
    stock_kind: StockKind;
    quantity: number;
    actor_user_id: string;
    business_day_id: string;
    visit_id: string | null;
    created_at: string;
  }[];
  check_items: (Count & {
    check_id: string;
    expected: number;
    declared: number;
    actual: number;
  })[];
  discrepancies: {
    id: string;
    check_id: string;
    product_id: string;
    stock_kind: StockKind;
    expected: number;
    actual: number;
    resolution: string;
    approved_by: string | null;
  }[];
  custody_history: {
    id: string;
    customer_id: string;
    product_id: string;
    delta: number;
    resulting_balance: number;
    reason: string;
    created_at: string;
  }[];
};
export const emptyWorkspace: Workspace = {
  available: false,
  customers: [],
  vehicles: [],
  drivers: [],
  products: [],
  locations: [],
  balances: [],
  custody: [],
  days: [],
  trips: [],
  loads: [],
  route: [],
  visits: [],
  items: [],
  payments: [],
  declarations: [],
  movements: [],
  checks: [],
  check_items: [],
  discrepancies: [],
  custody_history: [],
};
export function vehicleCounts(workspace: Workspace, trip: Trip): Count[] {
  const location = workspace.vehicles.find(
    (v) => v.id === trip.vehicle_id,
  )?.location_id;
  const assigned = new Set(workspace.loads.map((l) => l.product_id));
  return workspace.balances
    .filter((b) => b.location_id === location && assigned.has(b.product_id))
    .map(({ product_id, stock_kind, quantity }) => ({
      product_id,
      stock_kind,
      quantity,
    }));
}
export function moneyTotal(
  lines: { price: string; quantity: number }[],
): string {
  const cents = lines.reduce((sum, line) => {
    const [whole, fraction = ""] = line.price.split(".");
    return (
      sum +
      (BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, "0"))) *
        BigInt(line.quantity)
    );
  }, 0n);
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, "0")}`;
}
