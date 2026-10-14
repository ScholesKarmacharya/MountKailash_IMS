import type { VisitItem, Workspace } from "./operations/types";
import { tripDayOpen } from "./operations/driver-workspace";
import { cents, decimal } from "./finance/money";
export type InstantContact = {
  id: string;
  name: string;
  phone: string;
  location: string;
};
export type InstantRecord = {
  id: string;
  customer_id: string;
  visit_id: string;
  trip_id: string;
  event_name: string;
  phone: string;
  location: string;
  notes: string;
  created_at: string;
  business_date: string;
  driver_id: string;
  driver: string;
  vehicle: string;
  vehicle_id?: string;
  documents_allowed?: boolean;
  trip_number: number;
  is_one_time: boolean;
  invoice_id: string | null;
  invoice_number: string | null;
  total: string;
  outstanding: string;
  available: string;
  collected: string;
  items: (VisitItem & { name: string; pending: number; returned: number })[];
  pending: number;
  returned: number;
  device?: boolean;
  review?: boolean;
};
export type InstantWorkspace = {
  available: boolean;
  records: InstantRecord[];
  unavailable_reason?: "schema" | "cache";
};
export type InstantHistory = {
  record: InstantRecord;
  jars: {
    id: string;
    product: string;
    delta: number;
    balance: number;
    reason: string;
    at: string;
    trip: number | null;
    driver: string | null;
  }[];
  payments: {
    id: string;
    number: string;
    amount: string;
    method: string;
    status: string;
    at: string;
  }[];
  adjustments: {
    reason: string;
    subtotal_delta: string;
    tax_delta: string;
    created_at: string;
  }[];
};
export function instantStatus(
  record: Pick<InstantRecord, "pending" | "outstanding" | "device" | "review">,
) {
  if (record.review) return "Needs Review";
  if (record.device) return "Saved on Device";
  if (record.pending > 0 && cents(record.outstanding) > 0n)
    return "Pending jars and payment";
  if (record.pending > 0) return "Pending Jar Return";
  if (cents(record.outstanding) > 0n) return "Pending Payment";
  return "Completed";
}
export function instantJarStatus(record: {
  pending: number;
  returned?: number;
  items?: { full_jars: number }[];
}) {
  if (record.pending > 0) return "Pending Return";
  if (
    record.items &&
    record.returned !== undefined &&
    record.items.reduce((n, i) => n + i.full_jars, 0) > record.returned
  )
    return "Resolved by Adjustment";
  return "All Returned";
}
export function instantPaymentStatus(
  record: Pick<InstantRecord, "outstanding">,
) {
  return cents(record.outstanding) > 0n ? "Credit Outstanding" : "Paid";
}
export function eligibleInstantTrips(workspace: Workspace, driver?: string) {
  return workspace.trips.filter(
    (trip) =>
      trip.status === "ACTIVE" &&
      (!driver || trip.driver_id === driver) &&
      tripDayOpen(workspace, trip) &&
      workspace.loads.some(
        (load) => load.trip_id === trip.id && load.quantity > 0,
      ),
  );
}
export function validateInstant(
  contact: InstantContact,
  full: number,
  empty: number,
  credit: boolean,
) {
  if (
    !contact.name.trim() ||
    contact.name.length > 120 ||
    !contact.location.trim() ||
    contact.location.length > 500 ||
    contact.phone.length > 40
  )
    throw new Error("Enter valid event contact and delivery details.");
  if (
    (credit || full > empty) &&
    (!/^[+0-9() -]+$/.test(contact.phone) ||
      !/^\d{7,15}$/.test(contact.phone.replace(/\D/g, "")))
  )
    throw new Error(
      "A contact name and valid phone number are required for outstanding jars or credit.",
    );
}
export function instantTotals(records: InstantRecord[]) {
  return {
    deliveries: records.length,
    jars: records.reduce(
      (n, r) => n + r.items.reduce((q, i) => q + i.full_jars, 0),
      0,
    ),
    returned: records.reduce((n, r) => n + r.returned, 0),
    pending: records.reduce((n, r) => n + r.pending, 0),
    collected: decimal(records.reduce((n, r) => n + cents(r.collected), 0n)),
    outstanding: decimal(
      records.reduce((n, r) => n + cents(r.outstanding), 0n),
    ),
  };
}
