"use client";

import type { Trip, Workspace } from "@/domain/operations/types";
import { tripCanStart } from "@/domain/operations/driver-workspace";
import { nepalDateLabel } from "@/domain/business-days/time";
import { useDriverRuntime } from "./driver-runtime-context";
import { OperationForm } from "./operation-form";
import { Message } from "./localization";

// Home and authenticated trip details use the same runtime-owned activation,
// automatic-device preflight, idempotent server command and snapshot refresh.
export function StartTripAction({
  trip: original,
  workspace,
}: {
  trip: Trip;
  workspace: Workspace;
}) {
  const runtime = useDriverRuntime();
  const trip = runtime?.tripStatus?.(original.id) ?? original;
  const current = runtime?.workspace;
  const w = current?.trips.some((t) => t.id === trip.id) ? current : workspace;
  if (trip.cancelled || trip.status === "CLOSED")
    return (
      <p className="text-sm">
        <Message
          value={
            trip.cancelled
              ? "This trip was cancelled. Open your current trip."
              : "This trip is no longer current. Open your current trip."
          }
        />
      </p>
    );
  if (trip.status === "DRAFT")
    return (
      <p className="text-sm">
        <Message value="The warehouse must confirm the trip load before you can start." />
      </p>
    );
  if (trip.status !== "LOADED")
    return trip.status === "ACTIVE" ? (
      <p role="status">
        <Message value="Trip active" />
      </p>
    ) : null;
  const future =
    (trip.scheduled_date ?? trip.date_label) > nepalDateLabel(new Date());
  const reason =
    runtime?.online === false
      ? "Connect to the internet to start this trip. After it starts, you can continue offline."
      : future
        ? "This prepared trip cannot start before its scheduled delivery date."
        : !tripCanStart(w, trip)
          ? "The warehouse must open the delivery day before you can start."
          : runtime?.offlinePrepState === "FAILED"
            ? (runtime.offlinePrepError ?? "Could not prepare offline access")
            : "";
  return (
    <OperationForm
      operation="start"
      trip={trip.id}
      requestKey={crypto.randomUUID()}
      label="Start Trip"
      confirm="Start delivering this confirmed warehouse load?"
      submitDisabled={!!reason}
      submitBlockedMessage={reason}
      submitHint={
        <p className="text-sm text-muted-foreground">
          <Message
            value={reason || "Start online, then continue deliveries offline."}
          />
        </p>
      }
    />
  );
}
