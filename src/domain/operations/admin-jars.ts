import type { PendingJar } from "./pending-jars";

export type JarCustomer = {
  id: string;
  name: string;
  phone: string;
  address: string;
  supply_type: "REGULAR" | "HOUSE";
  is_active: boolean;
  last_delivery: string | null;
  last_activity: string | null;
  driver_ids: string[];
  balances: {
    product_id: string;
    quantity: number;
    returned_this_month: number;
    overdue: number;
    oldest_outstanding: string | null;
  }[];
};
export type AdminJarWorkspace = {
  available: boolean;
  snapshot_at: string;
  month_start: string;
  month_end: string;
  customers: JarCustomer[];
  products: { id: string; name: string }[];
  drivers: { id: string; name: string }[];
};
export type JarHistory = {
  customer: Pick<
    JarCustomer,
    "id" | "name" | "phone" | "address" | "supply_type"
  >;
  balances: { product_id: string; product_name: string; quantity: number }[];
  pending: PendingJar[];
  allocations: {
    return_entry_id: string;
    delivery_entry_id: string;
    product_id: string;
    original_date: string;
    returned_at: string;
    source: string;
    quantity: number;
  }[];
  events: {
    id: string;
    occurred_at: string;
    confirmed_at: string;
    offline: boolean;
    driver_name: string | null;
    actor_name: string;
    trip_id: string | null;
    trip_number: number | null;
    reason: string;
    correction: boolean;
    outstanding_after: number;
    items: {
      product_id: string;
      product_name: string;
      delivered: number;
      returned: number;
      adjustment: number;
      net_change: number;
      product_balance: number;
    }[];
  }[];
};
export type JarFilters = {
  search: string;
  type: string;
  driver: string;
  product: string;
  balance: "outstanding" | "all" | "zero";
  sort: "highest" | "oldest" | "name";
};
export function jarQuantity(customer: JarCustomer, product = "") {
  return customer.balances
    .filter((b) => !product || b.product_id === product)
    .reduce((n, b) => n + b.quantity, 0);
}
export function oldestJar(customer: JarCustomer, product = "") {
  return (
    customer.balances
      .filter((b) => (!product || b.product_id === product) && b.quantity > 0)
      .map((b) => b.oldest_outstanding)
      .filter((date): date is string => !!date)
      .sort((a, b) => Date.parse(a) - Date.parse(b))[0] ?? null
  );
}
// Aggregate the authoritative quantities; never reconstruct balances from visits.
export function jarSummary(customers: JarCustomer[]) {
  return {
    outstanding: customers.reduce((n, c) => n + jarQuantity(c), 0),
    customers: customers.filter((c) => jarQuantity(c) > 0).length,
    returned: customers.reduce(
      (n, c) => n + c.balances.reduce((q, b) => q + b.returned_this_month, 0),
      0,
    ),
    overdue: customers.reduce(
      (n, c) => n + c.balances.reduce((q, b) => q + b.overdue, 0),
      0,
    ),
  };
}
export function filterJarCustomers(
  customers: JarCustomer[],
  filters: JarFilters,
) {
  const search = filters.search.trim().toLocaleLowerCase();
  return customers
    .filter((c) => {
      const quantity = jarQuantity(c, filters.product);
      return (
        `${c.name} ${c.phone}`.toLocaleLowerCase().includes(search) &&
        (!filters.type || c.supply_type === filters.type) &&
        (!filters.driver || c.driver_ids.includes(filters.driver)) &&
        (!filters.product ||
          c.balances.some((b) => b.product_id === filters.product)) &&
        (filters.balance === "all" ||
          (filters.balance === "zero" ? quantity === 0 : quantity > 0))
      );
    })
    .sort((a, b) => {
      if (filters.sort === "highest")
        return (
          jarQuantity(b, filters.product) - jarQuantity(a, filters.product) ||
          a.name.localeCompare(b.name) ||
          a.id.localeCompare(b.id)
        );
      if (filters.sort === "oldest")
        return (
          (Date.parse(oldestJar(a, filters.product) ?? "") || Infinity) -
            (Date.parse(oldestJar(b, filters.product) ?? "") || Infinity) ||
          a.name.localeCompare(b.name) ||
          a.id.localeCompare(b.id)
        );
      return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
    });
}
