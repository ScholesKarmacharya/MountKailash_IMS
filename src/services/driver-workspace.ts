import "server-only";
import { getOperations } from "./operations";
import { getFinance } from "./finance";
import { currentRound } from "@/domain/operations/driver-workspace";

export async function getDriverWorkspace() {
  const [overview, finance] = await Promise.all([
    getOperations(false),
    getFinance(false),
  ]);
  const trip = currentRound(overview);
  const workspace = trip ? await getOperations(false, trip.id) : overview;
  const day =
    overview.days.find((d) => d.status === "OPEN") ??
    overview.days.find((d) => d.status === "CLOSING_REVIEW");
  const dayOpen =
    !!trip &&
    workspace.days.some(
      (d) => d.id === trip.business_day_id && d.status === "OPEN",
    );
  return {
    overview,
    workspace,
    finance,
    trip,
    day,
    dayOpen,
    delivering: trip?.status === "ACTIVE" && dayOpen,
  };
}
