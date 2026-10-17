"use client";
import { Check, LoaderCircle, AlertCircle } from "lucide-react";
import { T } from "./localization";
import { Button } from "./ui/button";
import type { Connectivity } from "@/domain/offline/connectivity";
import type { OfflinePrepState } from "./driver-runtime-context";
import type { SyncView } from "@/lib/offline/sync";

export function DriverConnectivityStatus({
  mode,
  prep,
  pending,
  status,
  retry,
}: {
  mode: Connectivity;
  prep: OfflinePrepState;
  pending: number;
  status: SyncView["status"];
  retry: () => void;
}) {
  const attention =
    prep === "FAILED" ||
    status === "Needs Review" ||
    ["AUTHORIZATION", "AUTHENTICATION", "DATABASE"].includes(mode);
  return (
    <div
      data-testid="driver-sync-status"
      className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-xl border border-border bg-card px-3 py-2 text-xs font-medium"
      aria-live="polite"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <span>
          <T k={mode === "OFFLINE" ? "Offline" : "Online"} />
        </span>
        <span aria-hidden>·</span>
        {attention ? (
          <AlertCircle className="size-4 text-amber-700" aria-hidden />
        ) : prep === "PREPARING" || (pending && mode === "ONLINE") ? (
          <LoaderCircle
            className="size-4 animate-spin text-primary"
            aria-hidden
          />
        ) : (
          <Check className="size-4 text-primary" aria-hidden />
        )}
        {attention ? (
          <T k="Needs attention" />
        ) : prep === "PREPARING" ? (
          <span role="status">
            <T k="Preparing trip for offline use..." />
          </span>
        ) : (
          <span data-testid="pending-sync-count" role="status">
            {mode === "OFFLINE" ? (
              <T k="{0} changes saved on this phone" values={[pending]} />
            ) : pending ? (
              <T k="Syncing {0} changes..." values={[pending]} />
            ) : status === "Syncing" ? (
              <T k="Updating balances..." />
            ) : status === "Sync Failed" ? (
              <T k="Waiting to sync" />
            ) : prep === "READY" ? (
              <T k="All synced" />
            ) : (
              <T k="Waiting for your trip" />
            )}
          </span>
        )}
        {prep === "READY" && (
          <>
            <span aria-hidden>·</span>
            <span>
              <T k="Offline ready" />
            </span>
            <Check className="size-3" aria-hidden />
          </>
        )}
        {prep === "FAILED" && (
          <span>
            <T k="Could not prepare offline access" />
          </span>
        )}
      </div>
      {prep === "FAILED" && (
        <Button type="button" variant="outline" onClick={retry}>
          <T k="Retry" />
        </Button>
      )}
    </div>
  );
}
