import { expect, it } from "vitest";
import {
  filterJarCustomers,
  jarSummary,
  jarQuantity,
  type JarCustomer,
  type JarFilters,
} from "@/domain/operations/admin-jars";
const filters: JarFilters = {
  search: "",
  type: "",
  driver: "",
  product: "",
  balance: "outstanding",
  sort: "highest",
};
const make = (
  id: string,
  qty: number,
  oldest: string | null,
  type: "HOUSE" | "REGULAR" = "REGULAR",
): JarCustomer => ({
  id,
  name: `${id} Hotel`,
  phone: "9801234567",
  address: "Kathmandu",
  supply_type: type,
  is_active: true,
  last_activity: null,
  last_delivery: null,
  driver_ids: ["driver"],
  balances: [
    {
      product_id: "jar",
      quantity: qty,
      returned_this_month: 5,
      overdue: oldest ? qty : 0,
      oldest_outstanding: oldest,
    },
  ],
});
const rows = [
  make("A", 13, "2026-10-01T00:00:00Z"),
  make("B", 5, "2026-08-01T00:00:00Z", "HOUSE"),
  make("Z", 0, null),
];
it("defaults to one card per outstanding customer, highest first, and allows zero balances", () => {
  expect(filterJarCustomers(rows, filters).map((c) => c.id)).toEqual([
    "A",
    "B",
  ]);
  expect(
    filterJarCustomers(rows, { ...filters, balance: "zero" }).map((c) => c.id),
  ).toEqual(["Z"]);
  expect(
    filterJarCustomers(rows, {
      ...filters,
      balance: "all",
      sort: "oldest",
    }).map((c) => c.id),
  ).toEqual(["B", "A", "Z"]);
});
it("filters names, phones, HOUSE and served driver without truncating the customer balance", () => {
  expect(
    filterJarCustomers(rows, { ...filters, search: " b hotel " }).map(
      (c) => c.id,
    ),
  ).toEqual(["B"]);
  expect(
    filterJarCustomers(rows, {
      ...filters,
      search: "1234567",
      type: "HOUSE",
      driver: "driver",
    }).map((c) => c.id),
  ).toEqual(["B"]);
  expect(filterJarCustomers(rows, { ...filters, driver: "unknown" })).toEqual(
    [],
  );
  expect(
    jarQuantity(filterJarCustomers(rows, { ...filters, driver: "driver" })[0]!),
  ).toBe(13);
});
it("uses selected product quantities and FIFO dates while global summaries include fully returned customers", () => {
  const multiple = {
    ...rows[0]!,
    balances: [
      ...rows[0]!.balances,
      {
        product_id: "second",
        quantity: 2,
        returned_this_month: 0,
        overdue: 0,
        oldest_outstanding: "2026-07-01T00:00:00Z",
      },
    ],
  };
  expect(jarQuantity(multiple, "second")).toBe(2);
  expect(
    filterJarCustomers([multiple, ...rows.slice(1)], {
      ...filters,
      product: "second",
    }).map((c) => c.id),
  ).toEqual(["A"]);
  expect(jarSummary(rows)).toEqual({
    outstanding: 18,
    customers: 2,
    returned: 15,
    overdue: 18,
  });
});
