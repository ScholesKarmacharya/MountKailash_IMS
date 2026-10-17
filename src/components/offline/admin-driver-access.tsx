"use client";

import { useActionState, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { resetOfflineAccessAction } from "@/app/admin/drivers/actions";
import type { DriverOfflineAccess } from "@/domain/offline/admin";
import { AdminDialog, DialogClose } from "@/components/admin-dialog";
import { T, DateValue, Value, useLocale } from "@/components/localization";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/operation-form";

export function AdminDriverOfflineAccess({
  driver,
  access,
}: {
  driver: { id: string; name: string };
  access: DriverOfflineAccess;
}) {
  const [success, setSuccess] = useState("");
  return (
    <Card className="space-y-4" data-testid="driver-offline-access">
      <h2 className="text-lg font-semibold">
        <T k="Offline Access" />
      </h2>
      <p className="font-medium">{driver.name}</p>
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-muted-foreground">
            <T k="Previous device" />
          </dt>
          <dd>
            <T
              k={access.previous_device_revoked ? "Revoked" : "Not recorded"}
            />
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">
            <T k="Last reset" />
          </dt>
          <dd>
            {access.last_reset_at ? (
              <DateValue value={access.last_reset_at} time />
            ) : (
              <T k="Not recorded" />
            )}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">
            <T k="Status" />
          </dt>
          <dd className="font-semibold">
            <T k={access.status} />
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">
            <T k="Current device" />
          </dt>
          <dd>
            <T
              k={
                !access.available
                  ? "Not available"
                  : access.device_registered
                    ? "Registered"
                    : "No device registered"
              }
            />
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">
            <T k="Current trip" />
          </dt>
          <dd>
            {access.trip_number !== null ? (
              <>
                #<Value value={access.trip_number} />
              </>
            ) : (
              <T k={access.available ? "No active trip" : "Not available"} />
            )}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">
            <T k="Vehicle" />
          </dt>
          <dd>{access.vehicle ?? <T k="Not available" />}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">
            <T k="Last registered" />
          </dt>
          <dd>
            {access.registered_at ? (
              <DateValue value={access.registered_at} time />
            ) : (
              <T k="Not recorded" />
            )}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">
            <T k="Last sync" />
          </dt>
          <dd>
            {access.last_synced_at ? (
              <DateValue value={access.last_synced_at} time />
            ) : (
              <T k="Not recorded" />
            )}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">
            <T k="Reported pending changes" />
          </dt>
          <dd>
            {access.reported_pending !== null ? (
              <Value value={access.reported_pending} />
            ) : (
              <T k="Not recorded" />
            )}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">
            <T k="Server records needing review" />
          </dt>
          <dd>
            {access.review_count !== null ? (
              <Value value={access.review_count} />
            ) : (
              <T k="Not available" />
            )}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">
            <T k="Server records awaiting retry" />
          </dt>
          <dd>
            {access.retry_count !== null ? (
              <Value value={access.retry_count} />
            ) : (
              <T k="Not available" />
            )}
          </dd>
        </div>
      </dl>
      <p className="text-sm text-muted-foreground">
        <T k="Status reflects the latest information received by the server. Changes saved only on a phone cannot be counted here." />
      </p>
      {!access.available && (
        <p role="alert" className="text-sm">
          <T k="The offline access update must be deployed before reset is available." />
        </p>
      )}
      {access.reset_pending && (
        <p className="text-sm">
          <T k="The previous device is revoked. The driver can reopen the app while online to prepare the replacement phone." />
        </p>
      )}
      {access.available && !access.can_reset && !access.reset_pending && (
        <p className="text-sm text-muted-foreground">
          <T
            k={
              access.status === "Needs update"
                ? "This trip requires review in Driver sync before its offline access can be reset."
                : "There is no registered device or current offline access to reset."
            }
          />
        </p>
      )}
      <AdminDialog
        title="Reset offline access?"
        triggerLabel="Reset Offline Access"
        destructive
        disabled={!access.can_reset}
        icon={<AlertTriangle className="size-4" aria-hidden="true" />}
      >
        <OfflineAccessResetForm
          driver={driver}
          trip={access.trip_id}
          onSuccess={setSuccess}
        />
      </AdminDialog>
      {success && (
        <p
          role="status"
          className="rounded-lg bg-teal-50 p-3 text-sm text-teal-900"
        >
          <T k={success} />
        </p>
      )}
    </Card>
  );
}

// The dialog unmounts this form when closed. Each new confirmation gets its own
// stable request key, while retries of that confirmation remain idempotent.
function OfflineAccessResetForm({
  driver,
  trip,
  onSuccess,
}: {
  driver: { id: string; name: string };
  trip: string | null;
  onSuccess: (message: string) => void;
}) {
  const [state, action, pending] = useActionState(
    async (
      previous: Awaited<ReturnType<typeof resetOfflineAccessAction>>,
      form: FormData,
    ) => {
      const result = await resetOfflineAccessAction(previous, form);
      if (result?.success) onSuccess(result.success);
      return result;
    },
    null,
  );
  const [key] = useState(() => crypto.randomUUID());
  const { t } = useLocale();
  return (
    <form action={action} aria-busy={pending} className="space-y-4">
      <p>
        {t("Reset offline access for {driver name}?").replace(
          "{driver name}",
          driver.name,
        )}
      </p>
      <p>
        <T k="This will revoke the previous device and allow the driver to prepare offline access on a new phone or browser." />
      </p>
      <p>
        <T k="Previous sales, deliveries, offline records and audit history will be preserved." />
      </p>
      <p
        role="alert"
        className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"
      >
        <T k="Changes that exist only on the old phone may not be recoverable after reset." />
      </p>
      <input type="hidden" name="driver" value={driver.id} />
      <input type="hidden" name="trip" value={trip ?? ""} />
      <input type="hidden" name="key" value={key} />
      <fieldset disabled={pending || !!state?.success}>
        <Field name="reason" label="Reason (optional)" maxLength={500} />
      </fieldset>
      {state?.error && (
        <p role="alert" className="text-sm text-red-800">
          <T k={state.error} />
        </p>
      )}
      {state?.success ? (
        <>
          <p role="status">
            <T k={state.success} />
          </p>
          <DialogClose label="Close dialog" />
        </>
      ) : (
        <div className="flex flex-wrap gap-3">
          <DialogClose disabled={pending} />
          <Button
            type="submit"
            disabled={pending}
            className="bg-red-700 text-white hover:bg-red-800"
          >
            <T k={pending ? "Saving…" : "Reset Access"} />
          </Button>
        </div>
      )}
    </form>
  );
}
