import "server-only";
import { getOperations } from "./operations";
import { getFinance } from "./finance";
import {
  currentRound,
  tripDayOpen,
} from "@/domain/operations/driver-workspace";
import { eligibleInstantTrips } from "@/domain/instant";
import { uuid } from "@/domain/inventory/validation";

export async function getDriverWorkspace(selectedTrip?: string) {
  const [overview, finance] = await Promise.all([
    getOperations(false),
    getFinance(false),
  ]);
  const requested = selectedTrip ? uuid(selectedTrip) : undefined;
  // The overview RPC deliberately omits load rows. Check each active candidate
  // using its authorized trip-scoped snapshot before offering Instant Delivery.
  const active = overview.trips.filter(
    (t) => t.status === "ACTIVE" && tripDayOpen(overview, t),
  );
  const snapshots = await Promise.all(
    active.map((t) => getOperations(false, t.id)),
  );
  const eligibleTrips = snapshots.flatMap((w) => eligibleInstantTrips(w));
  const trip = requested
    ? eligibleTrips.find((t) => t.id === requested)
    : eligibleTrips.length === 1
      ? eligibleTrips[0]
      : currentRound(overview);
  if (selectedTrip && !trip)
    throw new Error(
      "Choose an authorized active delivery trip with confirmed stock.",
    );
  const workspace = trip
    ? (snapshots.find((w) => w.trips.some((t) => t.id === trip.id)) ??
      (await getOperations(false, trip.id)))
    : overview;
  const day =
    overview.days.find((d) => d.status === "OPEN") ??
    overview.days.find((d) => d.status === "CLOSING_REVIEW");
  const dayOpen = !!trip && tripDayOpen(workspace, trip);
  return {
    overview,
    workspace,
    finance,
    trip,
    day,
    dayOpen,
    delivering: trip?.status === "ACTIVE" && dayOpen,
    eligibleTrips,
    tripChoiceRequired: eligibleTrips.length > 1 && !selectedTrip,
  };
}
