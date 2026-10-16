import { randomUUID } from "node:crypto";
import Link from "next/link";
import { getOfflineAdmin, getTrustedDevices } from "@/services/offline-admin";
import { getOperations } from "@/services/operations";
import { vehicleCounts } from "@/domain/operations/types";
import { Card } from "@/components/ui/card";
import { OperationalRefresh } from "@/components/operational-refresh";
import { T, Message, DateValue, Value } from "@/components/localization";
import { OperationsHeading } from "@/components/operations-layout";
import { MetricGrid, ReportPanel } from "@/components/report-ui";
import { StatusBadge } from "@/components/ui/status-badge";
import { OperationForm, Field } from "@/components/operation-form";
import { OfflineReviewFields } from "@/components/offline/review-fields";
import { OfflineExceptionForm } from "@/components/offline/admin-exception";
export default async function DriverSyncPage() {
  const [sync, w, devices] = await Promise.all([
    getOfflineAdmin(),
    getOperations(true),
    getTrustedDevices(),
  ]);
  const seen = [
    ...(devices ?? []).map((d) => d.last_seen_at),
    ...sync.rounds.map((r) => r.last_seen_at),
  ]
    .filter(Boolean)
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0];
  const needingReview = sync.operations.filter(
    (o) => o.status === "NEEDS_REVIEW",
  );
  const retained = sync.operations.filter((o) => o.status !== "NEEDS_REVIEW");
  const renderOperation = (o: (typeof sync.operations)[number]) => (
    <Card key={o.id} className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">
          <Message value={o.kind} />
        </h3>
        <StatusBadge
          label={o.status === "NEEDS_REVIEW" ? "Needs Review" : o.status}
          tone="warning"
        />
      </div>
      <p>
        <T k="Original occurrence" />: <DateValue value={o.occurred_at} time />
      </p>
      <p>
        <Message
          value={
            o.message ??
            "This record needs admin review. No business changes were posted."
          }
        />
      </p>
      <details>
        <summary className="py-3">
          <T k="Original record evidence" />
        </summary>
        <p className="break-all text-sm text-muted-foreground">{o.id}</p>
        <pre className="overflow-x-auto whitespace-pre-wrap break-all text-xs">
          {JSON.stringify(JSON.parse(o.payload), null, 2)}
        </pre>
      </details>
      <details>
        <summary className="min-h-12 cursor-pointer font-medium">
          <T k="Review received record" />
        </summary>
        <OperationForm
          operation="offline:review"
          id={o.id}
          requestKey={randomUUID()}
          label="Save review"
          confirm="Save this audited recovery decision?"
          preserveFields
        >
          <OfflineReviewFields
            kind={o.kind}
            house={!!JSON.parse(o.payload).house}
            customers={w.customers}
          />
          <Field
            name="reason"
            label="Reason and evidence"
            required
            maxLength={500}
          />
        </OperationForm>
      </details>
    </Card>
  );
  return (
    <div className="space-y-5" data-testid="sync-workspace">
      <OperationsHeading
        title="Driver sync"
        description="Only server-confirmed records appear in reports. Unreported records on an offline phone are unknown."
        actions={<OperationalRefresh compact />}
      />
      <MetricGrid
        items={[
          {
            label: "Trusted devices",
            value:
              devices === null ? (
                <T k="Unavailable" />
              ) : (
                devices.filter((d) => !d.revoked_at).length
              ),
          },
          {
            label: "Rounds needing review",
            value: sync.available ? (
              new Set(needingReview.map((o) => o.trip_id)).size
            ) : (
              <T k="Unavailable" />
            ),
          },
          {
            label: "Last device check-in",
            value: <DateValue value={seen} time />,
          },
        ]}
      />
      <h2 className="text-xl font-bold">
        <T k="Trusted driver devices" />
      </h2>
      {devices === null ? (
        <p>
          <T k="The device setup migration is required before preparing offline data." />
        </p>
      ) : (
        devices.map((d) => (
          <Card key={d.device_id} className="space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h3 className="font-semibold">{d.driver_name}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{d.name}</p>
              </div>
              <StatusBadge
                label={d.revoked_at ? "Device access revoked" : "Registered"}
                tone={d.revoked_at ? "neutral" : "positive"}
              />
            </div>
            <details>
              <summary className="min-h-12 cursor-pointer text-sm font-medium">
                <T k="Device audit details" />
              </summary>
              <p className="break-all text-sm text-muted-foreground">
                {d.device_id}
              </p>
            </details>
            <p>
              <T k="Last device check-in" />:{" "}
              <DateValue value={d.last_seen_at} time />
            </p>
            {d.last_synced_at && (
              <p>
                <T k="Last confirmed synchronization" />:{" "}
                <DateValue value={d.last_synced_at} time />
              </p>
            )}
            {!d.revoked_at && (
              <details>
                <summary className="min-h-12 cursor-pointer text-sm font-medium">
                  <T k="Manage device access" />
                </summary>
                <OperationForm
                  operation="offline:revoke-device"
                  id={d.device_id}
                  requestKey={randomUUID()}
                  label="Revoke Device"
                  confirm="Revoke this device? Unsynced records remain encrypted on the phone and need review."
                  preserveFields
                >
                  <Field
                    name="reason"
                    label="Reason and evidence"
                    required
                    maxLength={500}
                  />
                </OperationForm>
              </details>
            )}
          </Card>
        ))
      )}
      {!sync.available ? (
        <Card>
          <T k="The reviewed offline migration is required before preparing this device." />
        </Card>
      ) : (
        <>
          <h2 className="text-xl font-semibold">
            <T k="Device round checkpoints" />
          </h2>
          {!sync.rounds.length && (
            <Card>
              <T k="No offline rounds have been registered." />
            </Card>
          )}
          {sync.rounds.map((r) => {
            const trip = w.trips.find((t) => t.id === r.trip_id);
            return (
              <Card key={r.trip_id} className="space-y-3">
                <h3 className="text-lg font-semibold">
                  {r.driver_name} · <T k="Round" /> #{r.trip_number}
                </h3>
                <p>
                  <T k="Last device check-in" />:{" "}
                  <DateValue value={r.last_seen_at} time />
                </p>
                <p>
                  <T k="Last reported pending count" />:{" "}
                  <Value value={r.reported_pending} />
                </p>
                <p>
                  <StatusBadge
                    tone={r.phase === "SEALED" ? "positive" : "warning"}
                    label={
                      r.phase === "SEALED"
                        ? "Device queue checkpoint confirmed"
                        : r.phase === "EXCEPTION"
                          ? "Audited missing-device exception"
                          : "Device queue is not sealed; unsent records are unknown."
                    }
                  />
                </p>
                {r.checkpoint_at && (
                  <p>
                    <T k="Checkpoint" />:{" "}
                    <DateValue value={r.checkpoint_at} time />
                  </p>
                )}
                <Link
                  href={`/admin/trips/${r.trip_id}`}
                  className="inline-block py-3 text-primary underline"
                >
                  <T k="View trip" />
                </Link>
                {r.phase === "ACTIVE" && trip && (
                  <details>
                    <summary className="cursor-pointer py-3">
                      <T k="Lost or damaged device recovery" />
                    </summary>
                    <p className="my-3 text-amber-800">
                      <T k="This exception preserves unsent evidence and never invents sales or payments. Verify physical stock and recorded collections; complete reconciliation separately." />
                    </p>
                    <OfflineExceptionForm
                      trip={r.trip_id}
                      counts={vehicleCounts(w, trip)}
                      products={w.products}
                      requestKey={randomUUID()}
                    />
                  </details>
                )}
                {r.offline_device_reset_pending && (
                  <p role="status">
                    <T k="Offline access has been reset. Ask the replacement driver to tap Retry." />
                  </p>
                )}
                {!r.offline_device_reset_pending &&
                  trip &&
                  ["LOADED", "ACTIVE"].includes(trip.status) &&
                  ["PREPARED", "ACTIVE"].includes(r.phase) && (
                    <details>
                      <summary className="cursor-pointer py-3">
                        <T k="Reset Offline Device" />
                      </summary>
                      <p role="alert" className="my-3 text-amber-800">
                        <T k="The old phone may have unsynced changes that the server cannot see. Keep its app data and arrange admin review before replacing it. Reset revokes its access; all accepted records and history stay preserved." />{" "}
                        <T k="Reset also revokes other currently registered phones for this driver, so one replacement can prepare this trip." />
                      </p>
                      <OperationForm
                        operation="offline:reset-device"
                        trip={r.trip_id}
                        requestKey={randomUUID()}
                        label="Reset Offline Device"
                        confirm="The old phone may contain unsynced changes. Keep its data for admin review. Revoke its access and allow a replacement phone for this trip?"
                        preserveFields
                      >
                        <Field
                          name="reason"
                          label="Reason and evidence"
                          required
                          maxLength={500}
                        />
                      </OperationForm>
                    </details>
                  )}
              </Card>
            );
          })}
          <section
            className="space-y-4 rounded-xl border border-amber-300 bg-amber-50/40 p-4 sm:p-5"
            data-testid="sync-needs-review"
          >
            <h2 className="text-xl font-bold">
              <T k="Needs Review" />
            </h2>
            {!needingReview.length && (
              <p>
                <T k="No received records need review. Unreported device records remain unknown." />
              </p>
            )}
            {needingReview.map(renderOperation)}
          </section>
          {!!retained.length && (
            <ReportPanel title="Preserved recovery records" collapsed>
              {retained.map(renderOperation)}
            </ReportPanel>
          )}
          <ReportPanel title="Recovery audit" collapsed>
            {!sync.reviews.length && (
              <p className="text-sm text-muted-foreground">
                <T k="No recovery decisions recorded." />
              </p>
            )}
            {sync.reviews.map((e) => (
              <Card key={e.id}>
                <p>
                  <Message value={e.action} /> ·{" "}
                  <DateValue value={e.created_at} time />
                </p>
                <p>{e.reason}</p>
              </Card>
            ))}
          </ReportPanel>
        </>
      )}
    </div>
  );
}
