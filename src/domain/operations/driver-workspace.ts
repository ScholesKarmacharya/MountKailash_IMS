import { cents, decimal, sum } from "@/domain/finance/money";
import type { FinanceWorkspace } from "@/domain/finance/types";
import { vehicleCounts, type Trip, type Workspace } from "./types";

export function roundLabel(status: Trip["status"]) {
  return {
    DRAFT: "Waiting for warehouse loading",
    LOADED: "Ready to Start",
    ACTIVE: "Delivering",
    SUBMITTED: "Returned / Awaiting Confirmation",
    UNDER_REVIEW: "Returned / Awaiting Confirmation",
    DISCREPANCY: "Returned / Awaiting Confirmation",
    CLOSED: "Completed",
  }[status];
}

export function currentRound(workspace: Workspace) {
  const priority = [
    "ACTIVE",
    "LOADED",
    "SUBMITTED",
    "UNDER_REVIEW",
    "DISCREPANCY",
    "DRAFT",
  ];
  return [...workspace.trips]
    .filter((t) => t.status !== "CLOSED")
    .sort(
      (a, b) =>
        priority.indexOf(a.status) - priority.indexOf(b.status) ||
        b.created_at.localeCompare(a.created_at),
    )[0];
}

// The caller supplies a trip-scoped RPC snapshot. Never use today's vehicle
// balance to reconstruct a completed trip after that same vehicle is reloaded.
export function roundStock(w: Workspace, trip: Trip) {
  const loaded = (kind: string) =>
    w.loads
      .filter((l) => l.trip_id === trip.id && l.stock_kind === kind)
      .reduce((n, l) => n + l.quantity, 0);
  const returned = (kind: string) =>
    w.movements
      .filter((m) => m.movement_type === "TRIP_RETURN" && m.stock_kind === kind)
      .reduce((n, m) => n + m.quantity, 0);
  const remaining = (kind: string) =>
    trip.status === "CLOSED"
      ? 0
      : vehicleCounts(w, trip)
          .filter((b) => b.stock_kind === kind)
          .reduce((n, b) => n + b.quantity, 0);
  return {
    loadedFull: loaded("FULL_JAR"),
    soldFull: w.items.reduce((n, i) => n + i.full_jars, 0),
    remainingFull: remaining("FULL_JAR"),
    collectedEmpty: w.items.reduce((n, i) => n + i.empty_jars, 0),
    remainingEmpty: remaining("EMPTY_JAR"),
    returnedFull: returned("FULL_JAR"),
    returnedEmpty: returned("EMPTY_JAR"),
    loadedCartons: loaded("BOTTLE_CARTON"),
    soldCartons: w.items.reduce((n, i) => n + i.cartons, 0),
    remainingCartons: remaining("BOTTLE_CARTON"),
    returnedCartons: returned("BOTTLE_CARTON"),
    visits: w.visits.length,
    deliveries: w.visits.filter((v) =>
      w.items.some((i) => i.visit_id === v.id && i.full_jars + i.cartons > 0),
    ).length,
    customers: new Set(w.visits.map((v) => v.customer_id ?? v.id)).size,
  };
}

export function roundFinance(f: FinanceWorkspace, trip?: string, day?: string) {
  const sales = f.sales.filter((s) => !trip || s.trip_id === trip);
  const invoiceIds = new Set(
    f.invoices
      .filter((i) => sales.some((s) => s.id === i.sale_id))
      .map((i) => i.id),
  );
  const saleSources = new Set([
    ...invoiceIds,
    ...f.adjustments
      .filter((a) => invoiceIds.has(a.invoice_id))
      .map((a) => a.id),
  ]);
  const receipts = f.payments.filter((p) => !trip || p.trip_id === trip);
  const receiptIds = new Set(receipts.map((p) => p.id));
  const journal = f.journal.filter((j) => !day || j.business_day_id === day);
  const collected = (account: string) =>
    sum(
      journal
        .filter((j) => j.account === account && receiptIds.has(j.source_id))
        .map((j) => j.amount),
    );
  const issuedIds = new Set(
    f.invoices
      .filter((i) =>
        sales.some(
          (s) => s.id === i.sale_id && (!day || s.business_day_id === day),
        ),
      )
      .map((i) => i.id),
  );
  return {
    available: f.available,
    sales: decimal(
      -journal
        .filter(
          (j) =>
            ["SALES", "TAX_PAYABLE"].includes(j.account) &&
            saleSources.has(j.source_id),
        )
        .reduce((n, j) => n + cents(j.amount), 0n),
    ),
    cash: collected("CASH"),
    fonepayVerified: collected("FONEPAY"),
    fonepayPending: sum(
      receipts
        .filter(
          (p) =>
            p.method === "FONEPAY" &&
            p.status === "PENDING" &&
            (!day || p.business_day_id === day),
        )
        .map((p) => p.amount),
    ),
    creditIssued: sum(
      f.issued.filter((c) => issuedIds.has(c.invoice_id)).map((c) => c.amount),
    ),
  };
}
