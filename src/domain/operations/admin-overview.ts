import type { DayDetail, DayReport } from "@/domain/business-days/types";
import type { FinanceWorkspace } from "@/domain/finance/types";
import { financeMetrics } from "@/domain/finance/reports";
import { cents, decimal, npr } from "@/domain/finance/money";
import { roundStock } from "./driver-workspace";
import type { Trip, Workspace } from "./types";

// Presentation only: keep the report's posting-period membership, including
// overnight/carryover visits, rather than inventing new trip states.
export function overviewTripGroups(
  workspace: Workspace,
  day: { id: string; date_label: string } | null,
  report?: DayReport,
  lastClosedDate?: string,
) {
  const reportIds = new Set(report?.trips.map((t) => t.id));
  const today = day
    ? workspace.trips.filter(
        (t) =>
          !t.cancelled &&
          (t.scheduled_date ?? t.date_label) <= day.date_label &&
          (report
            ? reportIds.has(t.id)
            : t.business_day_id === day.id ||
              (["DRAFT", "LOADED"].includes(t.status) &&
                t.scheduled_date === day.date_label)),
      )
    : [];
  const referenceDate = day?.date_label ?? lastClosedDate;
  const future = referenceDate
    ? workspace.trips.filter(
        (t) =>
          !t.cancelled &&
          t.status === "LOADED" &&
          (t.scheduled_date ?? t.date_label) > referenceDate,
      )
    : [];
  return {
    today,
    future,
    scheduled: referenceDate
      ? workspace.trips.filter(
          (t) =>
            !t.cancelled &&
            t.status === "DRAFT" &&
            (t.scheduled_date ?? t.date_label) > referenceDate,
        )
      : [],
    active: today.filter((t) => t.status === "ACTIVE").length,
    awaiting: today.filter((t) =>
      ["SUBMITTED", "UNDER_REVIEW", "DISCREPANCY"].includes(t.status),
    ).length,
    ready: today.filter((t) => ["DRAFT", "LOADED"].includes(t.status)).length,
    prepared: report?.prepared_trips?.length ?? future.length,
    completed:
      report?.totals.completed_trips ??
      today.filter((t) => t.status === "CLOSED").length,
  };
}

export function overviewFinance(
  detail: DayDetail | null,
  finance: FinanceWorkspace,
  day: string | null,
) {
  if (detail) {
    const t = detail.report.totals;
    return {
      available: true,
      sales: t.sales,
      collections: t.collections,
      issued: t.new_credit,
      outstanding: t.outstanding,
      cash: t.cash,
      pending: t.pending_fonepay,
      fonepay: t.fonepay,
      recovered: t.old_credit_recovered,
      deposits: t.deposit_liability,
    };
  }
  return { available: finance.available, ...financeMetrics(finance, day) };
}

export function overviewRoundStock(workspace: Workspace, trip: Trip) {
  const stock = roundStock(workspace, trip);
  const freeFull = workspace.items
    .filter((i) => i.supply_classification === "FREE_SUPPLY")
    .reduce((n, i) => n + i.full_jars, 0);
  // The existing physical movement count includes HOUSE supply. Label only
  // sale-classified jars as sold; keep every supplied jar in stock movement.
  const freeCartons = workspace.items
    .filter((i) => i.supply_classification === "FREE_SUPPLY")
    .reduce((n, i) => n + i.cartons, 0);
  return {
    ...stock,
    soldFull: stock.soldFull - freeFull,
    soldCartons: stock.soldCartons - freeCartons,
    freeFull,
    freeCartons,
  };
}

export type OverviewActivity = {
  id: string;
  time: string;
  key: string;
  values: (string | number)[];
  stockLabel?: string;
  context: string;
  href: string;
  icon:
    "load" | "return" | "delivery" | "refill" | "damage" | "stock" | "money";
};

export function overviewActivity(report: DayReport, workspace: Workspace) {
  const audit = "/admin/reports/" + report.day.id;
  const rows: OverviewActivity[] = [];
  const labels: Record<string, string> = {
    FULL_JAR: "full jars",
    EMPTY_JAR: "empty jars",
    BOTTLE_CARTON: "cartons",
  };
  for (const movement of report.movements) {
    const type = String(movement.movement_type);
    const process = report.processing.find(
      (p) => p.id === movement.processing_id,
    );
    // A refill is one operation with an input and an output, not two refills.
    if (
      type === "REFILL_INPUT" &&
      movement.processing_id &&
      report.movements.some(
        (m) =>
          m.processing_id === movement.processing_id &&
          m.movement_type === "REFILL_OUTPUT",
      )
    )
      continue;
    const trip = workspace.trips.find((t) => t.id === movement.trip_id);
    const visit = report.customers.find((c) => c.id === movement.visit_id);
    const vehicle =
      trip?.plate_number ??
      workspace.vehicles.find(
        (v) =>
          v.location_id === movement.to_location_id ||
          v.location_id === movement.from_location_id,
      )?.plate_number;
    const product =
      workspace.products.find((p) => p.id === movement.product_id)?.name ??
      process?.product_name ??
      "";
    const quantity = Number(movement.quantity);
    const stockLabel = labels[String(movement.stock_kind)] ?? "units";
    let key = "{0} {1} moved in inventory";
    let values: (string | number)[] = [quantity, stockLabel];
    let icon: OverviewActivity["icon"] = "stock";
    switch (type) {
      case "TRIP_LOAD":
        key = vehicle
          ? "{0} {1} loaded to Vehicle {2}"
          : "{0} {1} loaded for delivery";
        values = vehicle ? [quantity, stockLabel, vehicle] : values;
        icon = "load";
        break;
      case "TRIP_RETURN":
      case "TRIP_UNLOAD":
        key = "{0} {1} returned to warehouse";
        icon = "return";
        break;
      case "DELIVERY":
        key = visit
          ? "{0} {1} delivered to {2}"
          : "{0} {1} delivered to customer";
        values = visit ? [quantity, stockLabel, visit.name] : values;
        icon = "delivery";
        break;
      case "EMPTY_COLLECTION":
        key = visit
          ? "{0} empty jars collected from {1}"
          : "{0} empty jars collected";
        values = visit ? [quantity, visit.name] : [quantity];
        icon = "return";
        break;
      case "REFILL_INPUT":
        key = "{0} empty jars sent for refilling";
        values = [quantity];
        icon = "refill";
        break;
      case "REFILL_OUTPUT":
        key = "{0} full jars added after refilling";
        values = [quantity];
        icon = "refill";
        break;
      case "WAREHOUSE_DAMAGE":
        key = "{0} {1} moved to damaged stock";
        icon = "damage";
        break;
      case "MANUAL_INCREASE":
        key = "{0} {1} added by an inventory correction";
        break;
      case "MANUAL_DECREASE":
        key = "{0} {1} removed by an inventory correction";
        break;
      case "VARIANCE_GAIN":
        key = "{0} {1} added after stock verification";
        break;
      case "VARIANCE_LOSS":
        key = "{0} {1} removed after stock verification";
        break;
    }
    rows.push({
      id: movement.id,
      time: String(movement.created_at),
      key,
      values,
      stockLabel: [
        "EMPTY_COLLECTION",
        "REFILL_INPUT",
        "REFILL_OUTPUT",
      ].includes(type)
        ? undefined
        : stockLabel,
      context: [trip?.driver_name, vehicle, product, process?.actor_name]
        .filter(Boolean)
        .join(" · "),
      href: trip ? "/admin/trips/" + trip.id : audit,
      icon,
    });
  }
  for (const j of report.journal.filter((j) =>
    ["CASH", "FONEPAY", "SALES"].includes(j.account),
  )) {
    const sale = j.account === "SALES";
    const payment = report.payments.find((p) => p.id === j.source_id);
    const customer = report.customers.find((c) => c.invoice_id === j.source_id);
    const saleTrip = workspace.trips.find((t) => t.id === customer?.trip_id);
    const key = sale
      ? j.kind === "INVOICE"
        ? "Sale recorded: {0}"
        : "Sales adjustment recorded: {0}"
      : j.kind === "REVERSAL"
        ? "Collection reversed: {0}"
        : j.account === "FONEPAY"
          ? "Fonepay collection verified: {0}"
          : j.kind === "PAYMENT"
            ? "Cash collection recorded: {0}"
            : "Cash movement recorded: {0}";
    rows.push({
      id: j.id,
      time: j.created_at,
      key,
      values: [npr(sale ? decimal(-cents(j.amount)) : j.amount)],
      context: payment
        ? [
            payment.driver_name,
            payment.plate_number,
            payment.customer_snapshot.name,
          ]
            .filter(Boolean)
            .join(" · ")
        : [saleTrip?.driver_name, saleTrip?.plate_number, customer?.name]
            .filter(Boolean)
            .join(" · "),
      href: payment
        ? "/admin/payments/" + payment.id
        : customer?.invoice_id
          ? "/admin/invoices/" + customer.invoice_id
          : audit,
      icon: "money",
    });
  }
  for (const event of report.events.filter((e) => e.status === "PENDING")) {
    const payment = report.payments.find((p) => p.id === event.payment_id);
    rows.push({
      id: event.id,
      time: String(event.created_at),
      key:
        payment && payment.status !== "PENDING"
          ? "Fonepay receipt recorded for verification"
          : "Fonepay receipt awaiting verification",
      values: [],
      context: payment
        ? [payment.driver_name, payment.plate_number].join(" · ")
        : "",
      href: payment ? "/admin/payments/" + payment.id : audit,
      icon: "money",
    });
  }
  return rows
    .sort((a, b) => b.time.localeCompare(a.time) || a.id.localeCompare(b.id))
    .slice(0, 6);
}
