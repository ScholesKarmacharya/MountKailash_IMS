import type { Customer, Workspace } from "./types";
import type { PendingJarWorkspace } from "./pending-jars";
import type { DeliveryCustomerContext } from "./customer-context";
import type { LocalState, DeliveryDraft } from "@/domain/offline/types";
import {
  customerEstimate,
  localCustomers,
  resolvedCustomer,
} from "@/domain/offline/operations";
import { inDateRange } from "@/domain/localization/calendar";
import { pendingDays } from "./pending-age";

export type DriverJarLot = {
  id: string;
  product_id: string;
  product_name: string;
  date: string;
  quantity: number;
  local: boolean;
  correction: boolean;
  round?: number | null;
};
export type DriverJarCustomer = {
  customer: Customer;
  pending: number;
  confirmed: number;
  deviceChange: number;
  status: "confirmed" | "device" | "review";
  lots: DriverJarLot[];
  oldest: string | null;
  lastDelivery: string | null;
  lastReturn: string | null;
  lastActivity: string | null;
};
export type DriverJarActivity = {
  id: string;
  date: string;
  product: string;
  delivered: number;
  returned: number;
  adjustment: number;
  balance: number;
  status: DriverJarCustomer["status"];
};
const latest = (dates: string[]) =>
  dates.sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null;
const oldest = (lots: DriverJarLot[]) =>
  lots.map((l) => l.date).sort((a, b) => Date.parse(a) - Date.parse(b))[0] ??
  null;
export function pendingDeviceDeliveries(state: LocalState, customer: string) {
  const included = new Set(
    state.snapshot.receipts
      .filter((r) => r.status === "CONFIRMED")
      .map((r) => r.id),
  );
  return state.operations.filter(
    (o) =>
      o.kind === "DELIVERY" &&
      !included.has(o.id) &&
      resolvedCustomer(
        state,
        (JSON.parse(o.payload) as DeliveryDraft).customer,
      ) === resolvedCustomer(state, customer),
  );
}

// Presentation only: confirmed FIFO lots come from the existing RPC. Device
// quantities come from customerEstimate; the previous OfflinePending lot preview
// is kept here so both connection modes can use the same customer-card view.
export function driverJarCustomers(
  workspace: Workspace,
  pending?: PendingJarWorkspace,
  state?: LocalState,
): DriverJarCustomer[] {
  const customers = state ? localCustomers(state) : workspace.customers;
  const seen = new Set<string>();
  return customers
    .filter((c) => {
      const id = state ? resolvedCustomer(state, c.id)! : c.id;
      if (!c.is_active || seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .map((customer) => {
      const context = state?.snapshot.contexts.find(
        (c) => c.customer.id === resolvedCustomer(state, customer.id),
      );
      const rows = state
        ? (context?.pending_jars ?? [])
        : (pending?.rows ?? []).filter((r) => r.customer_id === customer.id);
      const lots: DriverJarLot[] = rows.map((r) => ({
        id: r.entry_id,
        product_id: r.product_id,
        product_name: r.product_name,
        date: r.original_date,
        quantity: r.pending,
        local: false,
        correction: r.source !== "Delivery",
        round: r.trip_number,
      }));
      const operations = state
        ? pendingDeviceDeliveries(state, customer.id)
        : [];
      const fullProducts = workspace.products.filter(
        (p) => p.kind === "FULL_JAR",
      );
      const estimates = state
        ? fullProducts.map((p) => customerEstimate(state, customer.id, p.id))
        : [];
      for (const op of operations) {
        const draft = JSON.parse(op.payload) as DeliveryDraft;
        for (const item of draft.items.filter((i) =>
          fullProducts.some((p) => p.id === i.product_id),
        )) {
          if (item.full_jars)
            lots.push({
              id: `${op.id}:${item.product_id}`,
              product_id: item.product_id,
              product_name: fullProducts.find((p) => p.id === item.product_id)!
                .name,
              date: op.occurredAt,
              quantity: item.full_jars,
              local: true,
              correction: false,
              round: workspace.trips.find((t) => t.id === op.trip)?.trip_number,
            });
          let returned = item.empty_jars;
          for (const lot of lots.filter(
            (l) => l.product_id === item.product_id,
          )) {
            const take = Math.min(lot.quantity, returned);
            lot.quantity -= take;
            returned -= take;
          }
        }
      }
      const outstanding = lots.filter((l) => l.quantity > 0);
      const entries = state
        ? (context?.custody_history ?? [])
        : workspace.custody_history.filter(
            (e) => e.customer_id === customer.id,
          );
      const allocations = context?.jar_allocations ?? [];
      const returns = allocations
        .filter((a) => a.source === "Empty collection")
        .map((a) => a.returned_at);
      const visits = workspace.visits.filter(
        (v) => v.customer_id === customer.id,
      );
      const lastVisits = (kind: "full_jars" | "empty_jars") =>
        visits
          .filter((v) =>
            workspace.items.some((i) => i.visit_id === v.id && i[kind] > 0),
          )
          .map((v) => v.offline_occurred_at ?? v.created_at);
      const localDates = (kind?: "full_jars" | "empty_jars") =>
        operations
          .filter(
            (o) =>
              !kind ||
              (JSON.parse(o.payload) as DeliveryDraft).items.some(
                (i) => i[kind] > 0,
              ),
          )
          .map((o) => o.occurredAt);
      const confirmed = state
        ? estimates.reduce((n, e) => n + e.confirmed, 0)
        : rows.reduce((n, r) => n + r.pending, 0);
      const deviceChange = estimates.reduce((n, e) => n + e.pending, 0);
      return {
        customer,
        confirmed,
        deviceChange,
        pending: state
          ? estimates.reduce((n, e) => n + e.estimated, 0)
          : confirmed,
        status: operations.some((o) => o.status === "NEEDS_REVIEW")
          ? "review"
          : operations.length
            ? "device"
            : "confirmed",
        lots: outstanding,
        oldest: oldest(outstanding),
        lastDelivery: latest([
          ...rows
            .filter((r) => r.source === "Delivery")
            .map((r) => r.original_date),
          ...lastVisits("full_jars"),
          ...localDates("full_jars"),
        ]),
        lastReturn: latest([
          ...returns,
          ...lastVisits("empty_jars"),
          ...localDates("empty_jars"),
        ]),
        lastActivity: latest([
          ...rows.map((r) => r.original_date),
          ...entries.map((e) => e.created_at),
          ...localDates(),
          ...returns,
        ]),
      };
    });
}
export type DriverJarFilters = {
  search: string;
  from: string;
  to: string;
  sort: "highest" | "oldest" | "recent";
};
export function filterDriverJars(
  rows: DriverJarCustomer[],
  filters: DriverJarFilters,
) {
  const search = filters.search.trim().toLocaleLowerCase();
  return rows
    .filter(
      (r) =>
        r.pending > 0 &&
        `${r.customer.name} ${r.customer.phone}`
          .toLocaleLowerCase()
          .includes(search) &&
        ((!filters.from && !filters.to) ||
          r.lots.some((l) => inDateRange(l.date, filters.from, filters.to))),
    )
    .sort((a, b) => {
      const date = (value: string | null, fallback: number) =>
        value ? Date.parse(value) : fallback;
      const order =
        filters.sort === "highest"
          ? b.pending - a.pending
          : filters.sort === "oldest"
            ? date(a.oldest, Infinity) - date(b.oldest, Infinity)
            : date(b.lastActivity, 0) - date(a.lastActivity, 0);
      return (
        order ||
        a.customer.name.localeCompare(b.customer.name) ||
        a.customer.id.localeCompare(b.customer.id)
      );
    });
}
export function driverJarSummary(rows: DriverJarCustomer[], now = new Date()) {
  const outstanding = rows.filter((r) => r.pending > 0);
  const dates = outstanding.flatMap((r) => r.lots.map((l) => l.date));
  return {
    total: outstanding.reduce((n, r) => n + r.pending, 0),
    customers: outstanding.length,
    oldestDays: dates.length
      ? Math.max(...dates.map((d) => pendingDays(d, now)))
      : null,
  };
}
export function driverJarActivities(
  context: DeliveryCustomerContext | undefined,
  workspace: Workspace,
  state?: LocalState,
  customer?: string,
): DriverJarActivity[] {
  const allocations = context?.jar_allocations ?? [];
  const events: DriverJarActivity[] = (context?.custody_history ?? []).map(
    (e) => {
      const delivery = e.reason === "Full jars delivered",
        returned = e.reason === "Empty jars collected";
      const date =
        e.delta > 0
          ? (context?.pending_jars?.find((l) => l.entry_id === e.id)
              ?.original_date ??
            allocations.find((a) => a.delivery_entry_id === e.id)
              ?.original_date)
          : allocations.find((a) => a.return_entry_id === e.id)?.returned_at;
      return {
        id: e.id,
        date: date ?? e.created_at,
        product:
          workspace.products.find((p) => p.id === e.product_id)?.name ?? "",
        delivered: delivery ? e.delta : 0,
        returned: returned ? -e.delta : 0,
        adjustment: delivery || returned ? 0 : e.delta,
        balance: e.resulting_balance,
        status: "confirmed",
      };
    },
  );
  if (state && customer) {
    for (const op of pendingDeviceDeliveries(state, customer)) {
      const draft = JSON.parse(op.payload) as DeliveryDraft;
      const prefix = {
        ...state,
        operations: state.operations.slice(
          0,
          state.operations.findIndex((o) => o.id === op.id) + 1,
        ),
      };
      for (const item of draft.items.filter((i) =>
        workspace.products.some(
          (p) => p.id === i.product_id && p.kind === "FULL_JAR",
        ),
      ))
        events.unshift({
          id: `${op.id}:${item.product_id}`,
          date: op.occurredAt,
          product: workspace.products.find((p) => p.id === item.product_id)!
            .name,
          delivered: item.full_jars,
          returned: item.empty_jars,
          adjustment: 0,
          balance: customerEstimate(prefix, customer, item.product_id)
            .estimated,
          status: op.status === "NEEDS_REVIEW" ? "review" : "device",
        });
    }
  }
  return events;
}
