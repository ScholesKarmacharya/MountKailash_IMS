import type { LocalState, DeliveryDraft, CollectionDraft } from "./types";
import type {
  InstantWorkspace,
  InstantRecord,
  InstantHistory,
} from "../instant";
import { cents, decimal } from "../finance/money";
import { nepalDateLabel } from "../business-days/time";
export function projectedInstants(state: LocalState): InstantWorkspace {
  const records = new Map(
    (state.snapshot.instant?.records ?? []).map((r) => [
      r.id,
      structuredClone(r),
    ]),
  );
  const included = new Set(
    state.snapshot.receipts
      .filter((r) => r.status === "CONFIRMED")
      .map((r) => r.id),
  );
  const operations = state.operations.filter((o) => !included.has(o.id));
  const trip = state.snapshot.workspace.trips.find(
    (t) => t.id === state.snapshot.round.trip_id,
  )!;
  for (const op of operations.filter((o) => o.kind === "INSTANT")) {
    const d = JSON.parse(op.payload) as DeliveryDraft,
      c = d.instant!;
    const items = d.items.map((i) => ({
      ...i,
      visit_id: op.id,
      unit_price_snapshot: d.prices.find((p) => p.product_id === i.product_id)!
        .price,
      name: state.snapshot.workspace.products.find(
        (p) => p.id === i.product_id,
      )!.name,
      pending: i.full_jars - i.empty_jars,
      returned: i.empty_jars,
    }));
    const record: InstantRecord = {
      id: c.id,
      customer_id: c.id,
      visit_id: op.id,
      trip_id: op.trip,
      event_name: c.name,
      phone: c.phone,
      location: c.location,
      notes: d.notes,
      created_at: op.occurredAt,
      business_date: nepalDateLabel(new Date(op.occurredAt)),
      driver_id: state.user,
      driver: state.snapshot.profile.name,
      vehicle: trip.plate_number,
      vehicle_id: trip.vehicle_id,
      documents_allowed: false,
      trip_number: trip.trip_number,
      is_one_time: true,
      invoice_id: null,
      invoice_number: null,
      total: d.total,
      outstanding: d.status === "CREDIT" ? d.total : "0.00",
      available: "0.00",
      collected: d.status === "PAID" ? d.received! : "0.00",
      items,
      pending: items.reduce((n, i) => n + i.pending, 0),
      returned: items.reduce((n, i) => n + i.returned, 0),
      device: true,
      review: op.status === "NEEDS_REVIEW",
    };
    records.set(c.id, record);
  }
  for (const op of operations.filter(
    (o) => o.kind === "DELIVERY" || o.kind === "PAYMENT",
  )) {
    const d = JSON.parse(op.payload) as DeliveryDraft & CollectionDraft;
    const r = [...records.values()].find((r) => r.customer_id === d.customer);
    if (!r) continue;
    if (op.kind === "DELIVERY") {
      d.items.forEach((i) => {
        const product = r.items.find((x) => x.product_id === i.product_id);
        if (!product) return;
        const returned = Math.min(product.pending, i.empty_jars);
        product.pending -= returned;
        product.returned += returned;
      });
      r.pending = r.items.reduce((n, i) => n + i.pending, 0);
      r.returned = r.items.reduce((n, i) => n + i.returned, 0);
    } else if (d.method === "CASH") {
      const paid = d.allocations
        .filter((a) => a.invoice_id === r.invoice_id)
        .reduce((n, a) => n + cents(a.amount), 0n);
      r.collected = decimal(cents(r.collected) + paid);
      r.outstanding = decimal(cents(r.outstanding) - paid);
      r.available = decimal(cents(r.available) - paid);
    }
    r.device = true;
    r.review ||= op.status === "NEEDS_REVIEW";
  }
  return {
    available: state.snapshot.instant?.available ?? false,
    unavailable_reason:
      state.snapshot.instant?.unavailable_reason ??
      (state.snapshot.instant ? undefined : "cache"),
    records: [...records.values()].sort((a, b) =>
      b.created_at.localeCompare(a.created_at),
    ),
  };
}
export function cachedInstantHistory(
  state: LocalState,
  record: InstantRecord,
): InstantHistory {
  const context = state.snapshot.contexts.find(
    (c) => c.customer.id === record.customer_id,
  );
  const history: InstantHistory = {
    record,
    jars: (context?.custody_history ?? []).map((j) => ({
      id: j.id,
      product:
        state.snapshot.workspace.products.find((p) => p.id === j.product_id)
          ?.name ?? "",
      delta: j.delta,
      balance: j.resulting_balance,
      reason: j.reason,
      at: j.created_at,
      trip: null,
      driver: null,
    })),
    payments: state.snapshot.finance.allocations
      .filter((a) => a.invoice_id === record.invoice_id)
      .flatMap((a) => {
        const p = state.snapshot.finance.payments.find(
          (p) => p.id === a.payment_id,
        );
        return p
          ? [
              {
                id: p.id,
                number: p.number,
                amount: a.amount,
                method: p.method,
                status: p.status,
                at: p.created_at,
              },
            ]
          : [];
      }),
    adjustments: state.snapshot.finance.adjustments.filter(
      (a) => a.invoice_id === record.invoice_id,
    ),
  };
  const included = new Set(
    state.snapshot.receipts
      .filter((r) => r.status === "CONFIRMED")
      .map((r) => r.id),
  );
  const balances = new Map(
    (context?.custody ?? []).map((c) => [c.product_id, c.quantity]),
  );
  for (const op of state.operations.filter((o) => !included.has(o.id))) {
    const d = JSON.parse(op.payload) as DeliveryDraft & CollectionDraft;
    if (d.customer !== record.customer_id) continue;
    if (op.kind === "INSTANT" || op.kind === "DELIVERY") {
      for (const i of d.items)
        for (const [delta, reason] of [
          [i.full_jars, "Full jars delivered"],
          [-i.empty_jars, "Empty jars collected"],
        ] as const) {
          if (!delta) continue;
          const balance = (balances.get(i.product_id) ?? 0) + delta;
          balances.set(i.product_id, balance);
          history.jars.push({
            id: `${op.id}:${delta}`,
            product:
              state.snapshot.workspace.products.find(
                (p) => p.id === i.product_id,
              )?.name ?? "",
            delta,
            balance,
            reason,
            at: op.occurredAt,
            trip:
              state.snapshot.workspace.trips.find((t) => t.id === op.trip)
                ?.trip_number ?? null,
            driver: state.snapshot.profile.name,
          });
        }
      if (op.kind === "INSTANT" && d.status === "PAID")
        history.payments.push({
          id: op.id,
          number: "",
          amount: d.received!,
          method: "CASH",
          status:
            op.status === "NEEDS_REVIEW" ? "Needs Review" : "Saved on Device",
          at: op.occurredAt,
        });
    } else if (op.kind === "PAYMENT") {
      const amount = d.allocations
        .filter((a) => a.invoice_id === record.invoice_id)
        .reduce((n, a) => n + cents(a.amount), 0n);
      if (amount > 0n)
        history.payments.push({
          id: op.id,
          number: "",
          amount: decimal(amount),
          method: d.method,
          status:
            op.status === "NEEDS_REVIEW" ? "Needs Review" : "Saved on Device",
          at: op.occurredAt,
        });
    }
  }
  return history;
}
