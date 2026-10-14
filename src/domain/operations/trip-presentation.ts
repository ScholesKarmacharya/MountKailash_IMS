import type { Trip, TripStatus } from "./types";
export const tripStatusLabels: Record<TripStatus, string> = {
  DRAFT: "Draft",
  LOADED: "Prepared / Loaded",
  ACTIVE: "Active",
  SUBMITTED: "Awaiting confirmation",
  UNDER_REVIEW: "Under review",
  DISCREPANCY: "Discrepancy",
  CLOSED: "Completed / Closed",
};
export function tripLabel(trip: Trip) {
  return trip.cancelled ? "Cancelled" : tripStatusLabels[trip.status];
}
export function tripTone(trip: Trip): "neutral" | "positive" | "warning" {
  if (trip.cancelled || trip.status === "DRAFT") return "neutral";
  return ["SUBMITTED", "UNDER_REVIEW", "DISCREPANCY"].includes(trip.status)
    ? "warning"
    : "positive";
}
export function filterTrips(
  trips: Trip[],
  filters: { driver?: string; vehicle?: string; status?: string },
) {
  return trips.filter(
    (trip) =>
      (!filters.driver || trip.driver_id === filters.driver) &&
      (!filters.vehicle || trip.vehicle_id === filters.vehicle) &&
      (!filters.status ||
        (filters.status === "CANCELLED"
          ? trip.cancelled
          : !trip.cancelled && trip.status === filters.status)),
  );
}
