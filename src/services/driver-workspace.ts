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
  const candidate = requested
    ? eligibleTrips.find((t) => t.id === requested)
    : currentRound(overview);
  if (selectedTrip && !candidate)
    throw new Error(
      "Choose an authorized active delivery trip with confirmed stock.",
    );
  const workspace = candidate
    ? (snapshots.find((w) => w.trips.some((t) => t.id === candidate.id)) ??
      (await getOperations(false, candidate.id)))
    : overview;
  // Cancellation can commit between the overview and scoped reads. Prefer the
  // latter's metadata; never return an old LOADED label with a CLOSED snapshot.
  const scoped = workspace.trips.find((t) => t.id === candidate?.id);
  if (scoped)
    overview.trips = overview.trips.map((t) =>
      t.id === scoped.id ? scoped : t,
    );
  const trip =
    scoped && !scoped.cancelled && scoped.status !== "CLOSED"
      ? scoped
      : undefined;
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
