"use client";

import Link from "next/link";
import { useActionState, useRef, useState } from "react";
import {
  createTripAction,
  type TripCreationState,
} from "@/app/admin/trips/actions";
import { nepalDateLabel } from "@/domain/business-days/time";
import {
  availableTripAssignments,
  invalidProposedLoad,
  type TripLoadingWorkspace,
} from "@/domain/operations/trip-loading";
import type { Count, Workspace } from "@/domain/operations/types";
import { BsDatePicker } from "./bs-date-picker";
import {
  DateValue,
  LocalizedSelect,
  Message,
  T,
  Value,
  useLocale,
} from "./localization";
import { TripLoadProducts } from "./trip-load-products";
import { Field } from "./operation-form";
import { Button } from "./ui/button";

export function CreateTripForm({
  workspace,
  requestKey,
  id,
}: {
  workspace: Workspace;
  requestKey: string;
  id: string;
}) {
  const [identity, setIdentity] = useState({ requestKey, id });
  return (
    <TripCreationEditor
      key={identity.id}
      workspace={workspace}
      {...identity}
      onNext={() =>
        setIdentity({
          requestKey: crypto.randomUUID(),
          id: crypto.randomUUID(),
        })
      }
    />
  );
}

function TripCreationEditor({
  workspace,
  requestKey,
  id,
  onNext,
}: {
  workspace: TripLoadingWorkspace;
  requestKey: string;
  id: string;
  onNext: () => void;
}) {
  const { t } = useLocale();
  const inFlight = useRef(false);
  const [state, action, pending] = useActionState<TripCreationState, FormData>(
    async (
      previous: Parameters<typeof createTripAction>[0],
      form: FormData,
    ) => {
      try {
        return await createTripAction(previous, form);
      } catch {
        return {
          error:
            "Connection interrupted. Retry without changing the form to check the same request.",
          availability: previous?.availability,
        };
      } finally {
        inFlight.current = false;
      }
    },
    null,
  );
  const w = state?.availability ?? workspace;
  const open = w.days.find((d) => d.status === "OPEN");
  const [today] = useState(() => nepalDateLabel(new Date()));
  const [scheduled, setScheduled] = useState(() =>
    open && open.date_label > today ? open.date_label : today,
  );
  const [driver, setDriver] = useState("");
  const [vehicle, setVehicle] = useState("");
  const [items, setItems] = useState<Count[]>([]);
  const assignments = availableTripAssignments(w);
  const driverValid = assignments.drivers.some((d) => d.id === driver);
  const vehicleValid = assignments.vehicles.some((v) => v.id === vehicle);
  const quantitiesInvalid = invalidProposedLoad(w, items);
  const dateValid =
    !!open && scheduled >= open.date_label && scheduled >= today;
  const canDraft =
    dateValid && driverValid && vehicleValid && !quantitiesInvalid;
  const canConfirm = canDraft && items.some((i) => i.quantity > 0);
  const hint = !driver
    ? "Choose a driver."
    : !driverValid
      ? "This driver is already reserved for another trip."
      : !vehicle
        ? "Choose a vehicle."
        : !vehicleValid
          ? "This vehicle is already assigned to another trip."
          : !dateValid
            ? "Choose a valid scheduled delivery date."
            : quantitiesInvalid
              ? "Review current availability and adjust quantities."
              : !items.some((i) => i.quantity > 0)
                ? "Add at least one product."
                : "";

  if (state?.saved) {
    const { trip, items: savedItems, confirmed } = state.saved;
    return (
      <section
        role="status"
        data-testid="trip-creation-success"
        className="space-y-4 rounded-xl border border-teal-200 bg-teal-50 p-4 text-teal-950"
      >
        <h3 className="text-lg font-semibold">
          <T
            k={
              confirmed
                ? "Trip #{0} created and loaded successfully."
                : "Trip #{0} saved as a draft."
            }
            values={[trip.trip_number]}
          />
        </h3>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt>
              <T k="Driver" />
            </dt>
            <dd className="font-semibold">{trip.driver_name}</dd>
          </div>
          <div>
            <dt>
              <T k="Vehicle" />
            </dt>
            <dd className="font-semibold">{trip.plate_number}</dd>
          </div>
          <div>
            <dt>
              <T k="Scheduled delivery date" />
            </dt>
            <dd className="font-semibold">
              <DateValue value={trip.scheduled_date ?? trip.date_label} />
            </dd>
          </div>
          <div>
            <dt>
              <T k="Status" />
            </dt>
            <dd className="font-semibold">
              <T k={confirmed ? "Ready to Start" : "DRAFT"} />
            </dd>
          </div>
        </dl>
        {savedItems.length > 0 && (
          <ul className="space-y-1">
            {savedItems.map((i) => (
              <li key={i.product_id}>
                {w.products.find((p) => p.id === i.product_id)?.name}:{" "}
                <Value value={i.quantity} />
              </li>
            ))}
          </ul>
        )}
        {!confirmed && (
          <p className="text-sm">
            <T k="Proposed quantities saved. Warehouse stock is unchanged." />
          </p>
        )}
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button asChild>
            <Link href={`/admin/trips/${trip.id}`}>
              <T k="Open Trip" />
            </Link>
          </Button>
          <Button type="button" variant="outline" onClick={onNext}>
            <T k="Create another trip" />
          </Button>
        </div>
      </section>
    );
  }
  if (state?.existingId)
    return (
      <div role="status" className="space-y-3">
        <p>
          <Message value={state.error ?? "Record saved."} />
        </p>
        <Button asChild>
          <Link href={`/admin/trips/${state.existingId}`}>
            <T k="Open Trip" />
          </Link>
        </Button>
      </div>
    );
  if (!open)
    return (
      <p role="status">
        <T k="Open a business day in warehouse inventory before assigning a trip." />
      </p>
    );
  return (
    <form
      action={action}
      aria-busy={pending}
      className="space-y-5"
      onReset={(e) => e.preventDefault()}
      onSubmit={(e) => {
        const intent = (e.nativeEvent as SubmitEvent).submitter?.getAttribute(
          "value",
        );
        if (
          inFlight.current ||
          (intent === "CONFIRM" ? !canConfirm : !canDraft)
        ) {
          e.preventDefault();
          return;
        }
        if (
          intent === "CONFIRM" &&
          !window.confirm(
            t(
              "Confirm that these products have been physically loaded onto the vehicle?",
            ),
          )
        ) {
          e.preventDefault();
          return;
        }
        inFlight.current = true;
      }}
    >
      <input type="hidden" name="key" value={requestKey} />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="day" value={open.id} />
      <input type="hidden" name="items" value={JSON.stringify(items)} />
      <fieldset disabled={pending} className="min-w-0 space-y-5">
        <p className="text-sm">
          <T k="Business day:" />{" "}
          <strong>
            <DateValue value={open.date_label} />
          </strong>
        </p>
        <div className="grid min-w-0 items-start gap-4 md:grid-cols-2">
          <div className="grid min-w-0 gap-2 text-sm font-medium md:col-span-2">
            <span>
              <T k="Scheduled delivery date" />
            </span>
            <BsDatePicker
              name="scheduled"
              label="Scheduled delivery date"
              value={scheduled}
              onChange={setScheduled}
              min={open.date_label > today ? open.date_label : today}
              required
            />
          </div>
          <label className="grid min-w-0 gap-2 text-sm font-medium">
            <T k="Driver" />
            <LocalizedSelect
              name="driver"
              aria-label="Driver"
              value={driver}
              onChange={(e) => setDriver(e.target.value)}
              required
              className="min-h-12 w-full rounded-lg border border-input bg-background px-3"
            >
              <option value="">{t("Choose available driver")}</option>
              {driver && !driverValid && (
                <option value={driver} disabled>
                  {w.drivers.find((d) => d.id === driver)?.name} —{" "}
                  {t("Unavailable")}
                </option>
              )}
              {assignments.drivers.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </LocalizedSelect>
          </label>
          <label className="grid min-w-0 gap-2 text-sm font-medium">
            <T k="Vehicle" />
            <LocalizedSelect
              name="vehicle"
              aria-label="Vehicle"
              value={vehicle}
              onChange={(e) => setVehicle(e.target.value)}
              required
              className="min-h-12 w-full rounded-lg border border-input bg-background px-3"
            >
              <option value="">{t("Choose available vehicle")}</option>
              {vehicle && !vehicleValid && (
                <option value={vehicle} disabled>
                  {w.vehicles.find((v) => v.id === vehicle)?.plate_number} —{" "}
                  {t("Unavailable")}
                </option>
              )}
              {assignments.vehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.plate_number}
                </option>
              ))}
            </LocalizedSelect>
          </label>
        </div>
        <section className="min-w-0 space-y-3" aria-label="Load products">
          <h3 className="font-semibold">
            <T k="Load products" />
          </h3>
          <TripLoadProducts workspace={w} items={items} onChange={setItems} />
        </section>
        <Field name="notes" label="Trip notes (optional)" />
        <p className="text-sm text-muted-foreground">
          <T k="Warehouse stock changes only when physical loading is confirmed. A draft reserves the driver and vehicle." />
        </p>
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button
            type="submit"
            name="intent"
            value="DRAFT"
            variant="outline"
            className="min-h-12 w-full sm:w-auto"
            disabled={!canDraft || pending}
          >
            <T k="Save as Draft" />
          </Button>
          <Button
            type="submit"
            name="intent"
            value="CONFIRM"
            className="min-h-12 w-full sm:w-auto"
            disabled={!canConfirm || pending}
          >
            <T k={pending ? "Saving…" : "Create & Confirm Load"} />
          </Button>
        </div>
        {hint && (
          <p className="text-sm text-muted-foreground">
            <Message value={hint} />
          </p>
        )}
      </fieldset>
      {state?.error && (
        <div
          role="alert"
          className="rounded-lg bg-red-50 p-4 text-sm text-red-800"
        >
          <Message value={state.error} />
        </div>
      )}
    </form>
  );
}
