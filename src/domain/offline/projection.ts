import type { LocalState, DeliveryDraft } from "./types";
import type { DeliveryCustomerContext } from "@/domain/operations/customer-context";
import {
  localCustomers,
  localStock,
  customerEstimate,
  cachedCredit,
  resolvedCustomer,
} from "./operations";

export function projectedCustomer(
  state: LocalState,
  id: string,
): DeliveryCustomerContext {
  const customer = localCustomers(state).find((c) => c.id === id);
  if (!customer)
    throw new Error(
      "Customer not found. Choose another customer or contact the admin.",
    );
  const base = state.snapshot.contexts.find(
    (c) => c.customer.id === resolvedCustomer(state, id),
  );
  // Only locally created REGULAR contacts may use an empty context. HOUSE
  // eligibility always comes from the confirmed snapshot.
  if (
    !base &&
    !state.operations.some(
      (o) =>
        (o.kind === "CUSTOMER" && JSON.parse(o.payload).id === id) ||
        (o.kind === "INSTANT" && JSON.parse(o.payload).instant?.id === id),
    )
  )
    throw new Error(
      "Customer details are not cached. Reconnect before selecting this customer.",
    );
  const context: DeliveryCustomerContext = base
    ? structuredClone(base)
    : {
        customer,
        billing: null,
        prices: [],
        credit: [],
        custody: [],
        custody_history: [],
        credit_history: [],
        house_products: [],
        free_deliveries: [],
        pending_jars: [],
        jar_allocations: [],
      };
  context.customer = customer;
  context.custody = state.snapshot.workspace.products
    .filter((p) => p.kind === "FULL_JAR")
    .map((p) => ({
      customer_id: id,
      product_id: p.id,
      quantity: customerEstimate(state, id, p.id).estimated,
    }));
  context.credit = cachedCredit(state, id).map((c) => ({ ...c }));
  const included = new Set(
    state.snapshot.receipts
      .filter((r) => r.status === "CONFIRMED")
      .map((r) => r.id),
  );
  for (const o of state.operations.filter(
    (o) => ["DELIVERY", "INSTANT"].includes(o.kind) && !included.has(o.id),
  )) {
    const d = JSON.parse(o.payload) as DeliveryDraft;
    if (
      d.status === "CREDIT" &&
      resolvedCustomer(state, d.customer) === resolvedCustomer(state, id)
    )
      context.credit.push({
        id: o.id,
        number: "Device",
        customer_id: id,
        date_label:
          state.snapshot.workspace.trips.find((t) => t.id === o.trip)!
            .posting_date ??
          state.snapshot.workspace.trips.find((t) => t.id === o.trip)!
            .date_label,
        due_date: null,
        outstanding: d.total,
        available: "0.00",
      });
  }
  return context;
}
export function projectedWorkspace(state: LocalState) {
  const w = structuredClone(state.snapshot.workspace);
  w.customers = localCustomers(state);
  const trip = w.trips.find((t) => t.id === state.snapshot.round.trip_id)!;
  const location = w.vehicles.find(
    (v) => v.id === trip.vehicle_id,
  )!.location_id;
  w.balances = w.balances
    .filter((b) => b.location_id !== location)
    .concat(localStock(state).map((b) => ({ ...b, location_id: location })));
  w.custody = w.customers.flatMap((c) =>
    w.products
      .filter((p) => p.kind === "FULL_JAR")
      .map((p) => ({
        customer_id: c.id,
        product_id: p.id,
        quantity: customerEstimate(state, c.id, p.id).estimated,
      })),
  );
  const included = new Set(
    state.snapshot.receipts
      .filter((r) => r.status === "CONFIRMED")
      .map((r) => r.id),
  );
  for (const o of state.operations.filter(
    (o) => ["DELIVERY", "INSTANT"].includes(o.kind) && !included.has(o.id),
  )) {
    const d = JSON.parse(o.payload) as DeliveryDraft;
    w.visits.push({
      id: o.id,
      customer_id: d.customer,
      walk_in_name: d.walk_name,
      walk_in_phone: d.walk_phone,
      notes: d.notes,
      created_at: o.occurredAt,
      value_snapshot: d.total,
    });
    w.items.push(
      ...d.items.map((i) => ({
        ...i,
        visit_id: o.id,
        unit_price_snapshot: d.prices.find(
          (p) => p.product_id === i.product_id,
        )!.price,
      })),
    );
  }
  return w;
}
