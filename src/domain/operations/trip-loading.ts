import type { Count, Workspace } from "./types";

export type TripLoadingWorkspace = Pick<
  Workspace,
  | "available"
  | "days"
  | "drivers"
  | "vehicles"
  | "trips"
  | "products"
  | "balances"
  | "locations"
>;

export function tripLoadingWorkspace(w: Workspace): TripLoadingWorkspace {
  const {
    available,
    days,
    drivers,
    vehicles,
    trips,
    products,
    balances,
    locations,
  } = w;
  return {
    available,
    days,
    drivers,
    vehicles,
    trips,
    products,
    balances,
    locations,
  };
}

export function warehouseAvailable(w: TripLoadingWorkspace, product: string) {
  const p = w.products.find((p) => p.id === product);
  const warehouse = w.locations.find(
    (l) => l.code === "MAIN" && l.kind === "WAREHOUSE",
  );
  return (
    w.balances.find(
      (b) =>
        b.location_id === warehouse?.id &&
        b.product_id === product &&
        b.stock_kind === p?.kind,
    )?.quantity ?? 0
  );
}

export function availableTripAssignments(w: TripLoadingWorkspace) {
  const live = w.trips.filter((t) => t.status !== "CLOSED");
  return {
    drivers: w.drivers.filter(
      (d) => d.is_active && !live.some((t) => t.driver_id === d.id),
    ),
    vehicles: w.vehicles.filter(
      (v) =>
        v.is_active &&
        !live.some((t) => t.vehicle_id === v.id) &&
        !w.balances.some(
          (b) => b.location_id === v.location_id && b.quantity > 0,
        ),
    ),
  };
}

export function invalidProposedLoad(w: TripLoadingWorkspace, items: Count[]) {
  return items.some((item) => {
    const p = w.products.find((p) => p.id === item.product_id && p.is_active);
    return (
      !p ||
      item.stock_kind !== p.kind ||
      !Number.isSafeInteger(item.quantity) ||
      item.quantity < 0 ||
      item.quantity >
        Math.min(1000000000, warehouseAvailable(w, item.product_id))
    );
  });
}
