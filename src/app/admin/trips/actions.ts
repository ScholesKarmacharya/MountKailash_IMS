"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { getOperations, saveOperation } from "@/services/operations";
import {
  tripLoadingWorkspace,
  type TripLoadingWorkspace,
} from "@/domain/operations/trip-loading";
import type { Count, Trip } from "@/domain/operations/types";

export type TripCreationState = {
  error?: string;
  availability?: TripLoadingWorkspace;
  saved?: { trip: Trip; items: Count[]; confirmed: boolean };
  existingId?: string;
} | null;

export async function createTripAction(
  _previous: TripCreationState,
  form: FormData,
): Promise<TripCreationState> {
  // This action can only invoke the admin preparation command. The service and
  // RPC independently enforce permission; browser operation/actor fields do not.
  form.set("operation", "prepare-trip");
  let savedId: string | undefined;
  try {
    const id = await saveOperation(form);
    savedId = id;
    revalidatePath("/admin", "layout");
    revalidatePath("/driver", "layout");
    const workspace = await getOperations(true, id);
    const trip = workspace.trips.find((t) => t.id === id);
    if (!trip)
      throw new Error(
        "Trip saved. Retry with the same request to retrieve its confirmation.",
      );
    return {
      availability: tripLoadingWorkspace(workspace),
      saved: {
        trip,
        items:
          trip.status === "DRAFT"
            ? (trip.proposed_load_items ?? [])
            : workspace.loads.filter((l) => l.trip_id === id),
        confirmed: form.get("intent") === "CONFIRM",
      },
    };
  } catch (error) {
    unstable_rethrow(error);
    // Refresh stock and reservations on failure without replacing the mounted
    // form, its quantities, canonical BS/AD date or idempotency identifiers.
    let availability: TripLoadingWorkspace | undefined;
    try {
      const w = await getOperations(true);
      if (w.available) availability = tripLoadingWorkspace(w);
    } catch (readError) {
      unstable_rethrow(readError);
    }
    const existingId =
      savedId ??
      availability?.trips.find((trip) => trip.id === form.get("id"))?.id;
    return {
      error: existingId
        ? "This trip has been saved. Open it to check its current loading status."
        : error instanceof Error
          ? error.message
          : "Unable to save. Please retry.",
      availability,
      existingId,
    };
  }
}
