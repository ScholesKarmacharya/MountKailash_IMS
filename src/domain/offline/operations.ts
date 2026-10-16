import { uuid } from "@/domain/inventory/validation";
import { cents, decimal } from "@/domain/finance/money";
import { driverPaymentPlan } from "@/domain/finance/driver-payment";
import { paymentDraft } from "@/domain/finance/commands";
import type { CollectionDraft } from "./types";
import { vehicleCounts } from "@/domain/operations/types";
import { approvedHouse } from "@/domain/house/pricing";
import { validateInstant } from "@/domain/instant";
import type {
  ContactDraft,
  DeliveryDraft,
  Envelope,
  LocalState,
  Receipt,
} from "./types";

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b, "en"))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  if (value === undefined || typeof value === "function")
    throw new Error("Invalid offline record.");
  return JSON.stringify(value);
}
export async function fingerprint(payload: string): Promise<string> {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload)),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
export function validateEnvelope(value: unknown): Envelope {
  if (!value || typeof value !== "object")
    throw new Error("Invalid offline record.");
  const e = value as Envelope;
  uuid(e.id);
  uuid(e.trip);
  if (
    e.version !== 1 ||
    ![
      "CUSTOMER",
      "CONTACT",
      "DELIVERY",
      "PAYMENT",
      "SUBMIT",
      "PAUSE",
      "INSTANT",
    ].includes(e.kind) ||
    !Number.isSafeInteger(e.sequence) ||
    e.sequence < 1 ||
    e.sequence > 1000000 ||
    typeof e.payload !== "string" ||
    e.payload.length > 60000 ||
    !/^[a-f0-9]{64}$/.test(e.fingerprint) ||
    !Number.isFinite(Date.parse(e.occurredAt))
  )
    throw new Error("Invalid offline record.");
  if (canonical(JSON.parse(e.payload)) !== e.payload)
    throw new Error("Invalid offline record.");
  return {
    version: 1,
    id: e.id,
    trip: e.trip,
    sequence: e.sequence,
    kind: e.kind,
    occurredAt: e.occurredAt,
    payload: e.payload,
    fingerprint: e.fingerprint,
  };
}
export function confirmAcknowledgement(e: Envelope, receipt: Receipt) {
  if (
    receipt.id !== e.id ||
    receipt.trip !== e.trip ||
    receipt.sequence !== e.sequence ||
    receipt.fingerprint !== e.fingerprint ||
    receipt.status !== "CONFIRMED" ||
    !receipt.result ||
    !Number.isFinite(Date.parse(receipt.processedAt))
  )
    throw new Error(
      "Server confirmation did not match. The record remains on this device.",
    );
  uuid(receipt.result);
}
export function localStock(state: LocalState) {
  const w = state.snapshot.workspace;
  const trip = w.trips.find((t) => t.id === state.snapshot.round.trip_id);
  if (!trip) throw new Error("Confirmed load is unavailable.");
  const balances = vehicleCounts(w, trip).map((c) => ({ ...c }));
  const included = new Set(
    state.snapshot.receipts
      .filter((r) => r.status === "CONFIRMED")
      .map((r) => r.id),
  );
  for (const op of state.operations.filter(
    (o) => ["DELIVERY", "INSTANT"].includes(o.kind) && !included.has(o.id),
  )) {
    const draft = JSON.parse(op.payload) as DeliveryDraft;
    for (const i of draft.items)
      for (const [kind, delta] of [
        ["FULL_JAR", -i.full_jars],
        ["EMPTY_JAR", i.empty_jars],
        ["BOTTLE_CARTON", -i.cartons],
      ] as const) {
        // Zero quantities do not introduce another stock kind for this product.
        // A jar delivery must never fabricate a carton row in return counts.
        if (delta === 0) continue;
        let row = balances.find(
          (b) => b.product_id === i.product_id && b.stock_kind === kind,
        );
        if (!row) {
          row = { product_id: i.product_id, stock_kind: kind, quantity: 0 };
          balances.push(row);
        }
        row.quantity += delta;
      }
  }
  return balances;
}
export function localCustomers(state: LocalState) {
  const result = new Map(
    state.snapshot.workspace.customers.map((c) => [c.id, { ...c }]),
  );
  const included = new Set(
    state.snapshot.receipts
      .filter((r) => r.status === "CONFIRMED")
      .map((r) => r.id),
  );
  for (const op of state.operations.filter((o) =>
    ["CUSTOMER", "CONTACT"].includes(o.kind),
  )) {
    const c = JSON.parse(op.payload) as ContactDraft;
    const resolved = op.acknowledgement?.customer;
    const server = result.get(resolved ?? c.id);
    if (included.has(op.id)) {
      if (resolved && resolved !== c.id && server)
        result.set(c.id, { ...server, id: c.id });
      continue;
    }
    result.set(c.id, {
      ...result.get(c.id),
      ...c,
      id: c.id,
      notes: "",
      is_active: true,
      version: c.version + 1,
      house_status:
        c.supply_type === "HOUSE"
          ? server?.supply_type === "HOUSE"
            ? server.house_status
            : "PENDING"
          : (server?.house_status ?? "NONE"),
    });
  }
  for (const op of state.operations.filter((o) => o.kind === "INSTANT")) {
    const d = JSON.parse(op.payload) as DeliveryDraft;
    if (!d.instant || result.has(d.instant.id)) continue;
    result.set(d.instant.id, {
      id: d.instant.id,
      name: d.instant.name,
      phone: d.instant.phone,
      address: d.instant.location,
      shop_name: "",
      notes: "",
      is_active: true,
      version: 1,
      is_one_time: true,
      supply_type: "REGULAR",
      house_status: "NONE",
    });
  }
  return [...result.values()];
}
export function resolvedCustomer(
  state: LocalState,
  customer: string | null,
): string | null {
  return (
    state.operations.find(
      (o) =>
        o.kind === "CUSTOMER" &&
        (JSON.parse(o.payload) as ContactDraft).id === customer,
    )?.acknowledgement?.customer ?? customer
  );
}
export function customerEstimate(
  state: LocalState,
  customer: string,
  product: string,
) {
  const context = state.snapshot.contexts.find(
    (c) => c.customer.id === resolvedCustomer(state, customer),
  );
  const confirmed =
    context?.custody.find((c) => c.product_id === product)?.quantity ?? 0;
  const included = new Set(
    state.snapshot.receipts
      .filter((r) => r.status === "CONFIRMED")
      .map((r) => r.id),
  );
  const delta = state.operations
    .filter(
      (o) => ["DELIVERY", "INSTANT"].includes(o.kind) && !included.has(o.id),
    )
    .reduce((n, o) => {
      const d = JSON.parse(o.payload) as DeliveryDraft;
      return (
        n +
        (resolvedCustomer(state, d.customer) ===
        resolvedCustomer(state, customer)
          ? d.items
              .filter((i) => i.product_id === product)
              .reduce((q, i) => q + i.full_jars - i.empty_jars, 0)
          : 0)
      );
    }, 0);
  return { confirmed, pending: delta, estimated: confirmed + delta };
}
export function effectivePrice(
  state: LocalState,
  customer: string | null,
  product: string,
): string {
  if (cachedFreeProduct(state, customer, product)) return "0.00";
  return (
    state.snapshot.contexts
      .find((c) => c.customer.id === resolvedCustomer(state, customer))
      ?.prices.find((p) => p.product_id === product && p.active)?.price ??
    state.snapshot.workspace.products.find((p) => p.id === product)
      ?.default_price ??
    "0.00"
  );
}
export function cachedHouse(state: LocalState, customer: string | null) {
  const context = state.snapshot.contexts.find(
    (c) => c.customer.id === resolvedCustomer(state, customer),
  );
  return approvedHouse(context?.customer) ? context : null;
}
export function cachedFreeProduct(
  state: LocalState,
  customer: string | null,
  product: string,
) {
  return (
    cachedHouse(state, customer)?.house_products?.find((p) => p.id === product)
      ?.house_eligible === true
  );
}
export function houseEvidence(
  state: LocalState,
  draft: DeliveryDraft,
): DeliveryDraft["house"] {
  const context = cachedHouse(state, draft.customer);
  if (!context || !draft.items.some((i) => i.full_jars + i.cartons > 0))
    return undefined;
  return {
    version: context.customer.house_version!,
    products: draft.items.map((i) => {
      const p = context.house_products?.find((p) => p.id === i.product_id);
      if (!p) throw new Error("Confirmed HOUSE product evidence is required.");
      return {
        product_id: i.product_id,
        version: p.house_version,
        eligible: p.house_eligible,
        reference_price: p.reference_price,
      };
    }),
  };
}
export function invoiceTotal(state: LocalState, subtotal: bigint) {
  const company = state.snapshot.finance.company;
  const tax =
    company?.tax_mode === "EXPLICIT"
      ? (subtotal * cents(company.tax_rate) + 5000n) / 10000n
      : 0n;
  return decimal(subtotal + tax);
}
export function validateDelivery(state: LocalState, draft: DeliveryDraft) {
  if (draft.instant) {
    uuid(draft.instant.id);
    if (
      draft.customer !== draft.instant.id ||
      !["PAID", "CREDIT"].includes(draft.status) ||
      localCustomers(state).some((c) => c.id === draft.instant!.id)
    )
      throw new Error("Invalid one-time customer reference.");
    validateInstant(
      draft.instant,
      draft.items.reduce((n, i) => n + i.full_jars, 0),
      draft.items.reduce((n, i) => n + i.empty_jars, 0),
      draft.status === "CREDIT",
    );
  }
  if (state.paused)
    throw new Error(
      "This trip is paused for carryover. Resume online after admin authorization.",
    );
  if (state.snapshot.round.phase === "PREPARED")
    throw new Error(
      "Start this prepared trip online and synchronize before recording deliveries.",
    );
  if (state.sealed || state.snapshot.round.phase !== "ACTIVE")
    throw new Error(
      "This delivery round is sealed. No new sales can be recorded.",
    );
  if (state.operations.some((o) => o.status === "NEEDS_REVIEW"))
    throw new Error(
      "Resolve records needing review before recording more sales.",
    );
  if (
    !draft.items.length ||
    new Set(draft.items.map((i) => i.product_id)).size !== draft.items.length
  )
    throw new Error("Enter delivery quantities.");
  const stock = localStock(state);
  let total = 0n;
  for (const i of draft.items) {
    const product = state.snapshot.workspace.products.find(
      (p) => p.id === i.product_id && p.is_active,
    );
    if (
      !product ||
      !state.snapshot.workspace.loads.some((l) => l.product_id === i.product_id)
    )
      throw new Error("Select a product from the confirmed load.");
    if (
      [i.full_jars, i.empty_jars, i.cartons].some(
        (n) => !Number.isSafeInteger(n) || n < 0 || n > 1000000000,
      ) ||
      i.full_jars + i.empty_jars + i.cartons === 0 ||
      (product.kind === "BOTTLE_CARTON"
        ? i.full_jars + i.empty_jars !== 0
        : i.cartons !== 0)
    )
      throw new Error("Enter valid product quantities.");
    if (
      i.full_jars >
        (stock.find(
          (b) => b.product_id === i.product_id && b.stock_kind === "FULL_JAR",
        )?.quantity ?? 0) ||
      i.cartons >
        (stock.find(
          (b) =>
            b.product_id === i.product_id && b.stock_kind === "BOTTLE_CARTON",
        )?.quantity ?? 0)
    )
      throw new Error("Quantity exceeds remaining stock.");
    const custody = draft.customer
      ? customerEstimate(state, draft.customer, i.product_id).estimated
      : 0;
    if (i.empty_jars > custody + i.full_jars)
      throw new Error("Empty returns exceed the locally known jar balance.");
    total +=
      cents(effectivePrice(state, draft.customer, i.product_id)) *
      BigInt(i.full_jars + i.cartons);
  }
  if (invoiceTotal(state, total) !== draft.total)
    throw new Error("Prices changed. Review the sale total.");
  const sale = draft.items.some((i) => i.full_jars + i.cartons > 0);
  const free = draft.items
    .filter((i) => i.full_jars + i.cartons > 0)
    .every((i) => cachedFreeProduct(state, draft.customer, i.product_id));
  if (draft.status === "FREE_SUPPLY" && (!sale || !free))
    throw new Error(
      "Approved HOUSE status and eligible products are required for free delivery.",
    );
  if ((draft.status === "RETURN_ONLY") === sale)
    throw new Error("Payment status does not match the delivery.");
  if (
    draft.customer &&
    !draft.instant &&
    !localCustomers(state).some((c) => c.id === draft.customer)
  )
    throw new Error("Select a cached customer.");
  driverPaymentPlan({
    status: draft.status,
    total: draft.total,
    amount: draft.received ?? "",
    customer: draft.customer,
  });
}
export function retryDelay(attempt: number, random = Math.random()) {
  return (
    Math.min(300000, 2000 * 2 ** Math.min(attempt, 7)) * (0.75 + random * 0.5)
  );
}
export function cachedCredit(state: LocalState, customer: string) {
  const credit = structuredClone(
    state.snapshot.contexts.find(
      (c) => c.customer.id === resolvedCustomer(state, customer),
    )?.credit ?? [],
  );
  const included = new Set(
    state.snapshot.receipts
      .filter((r) => r.status === "CONFIRMED")
      .map((r) => r.id),
  );
  for (const o of state.operations.filter(
    (o) => o.kind === "PAYMENT" && !included.has(o.id),
  )) {
    const d = JSON.parse(o.payload) as CollectionDraft;
    if (
      resolvedCustomer(state, d.customer) !== resolvedCustomer(state, customer)
    )
      continue;
    for (const a of d.allocations) {
      const row = credit.find((c) => c.id === a.invoice_id);
      if (row) {
        row.available = decimal(cents(row.available) - cents(a.amount));
        if (d.method === "CASH")
          row.outstanding = decimal(cents(row.outstanding) - cents(a.amount));
      }
    }
  }
  return credit;
}
export function validateCollection(state: LocalState, value: CollectionDraft) {
  const d = paymentDraft(value);
  if (
    !localCustomers(state).some((c) => c.id === value.customer) ||
    cents(d.amount) <= 0n ||
    cents(d.current_amount ?? "0") !== 0n ||
    cents(d.amount) !==
      cents(d.deposit_amount) +
        d.allocations.reduce((n, a) => n + cents(a.amount), 0n)
  )
    throw new Error("Invalid payment amount.");
  if (
    cents(d.deposit_amount) > 0n &&
    state.snapshot.contexts.find(
      (c) => c.customer.id === resolvedCustomer(state, value.customer),
    )?.billing?.deposit_mode !== "MANUAL"
  )
    throw new Error("Manual deposits are not configured for this customer.");
  const credit = cachedCredit(state, value.customer);
  if (
    new Set(d.allocations.map((a) => a.invoice_id)).size !==
      d.allocations.length ||
    d.allocations.some(
      (a) =>
        cents(a.amount) >
        cents(credit.find((c) => c.id === a.invoice_id)?.available ?? "0"),
    )
  )
    throw new Error("Collection exceeds available outstanding credit.");
}
