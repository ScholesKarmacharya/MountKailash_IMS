import {
  confirmAcknowledgement,
  retryDelay,
} from "@/domain/offline/operations";
import type {
  DeviceRound,
  LocalState,
  OfflineSnapshot,
  Receipt,
} from "@/domain/offline/types";
import type { OfflineVault } from "./store";

export class SyncError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 0,
  ) {
    super(message);
  }
}
export async function offlineRequest<T>(
  body?: Record<string, unknown>,
): Promise<T> {
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), 15000);
  try {
    const r = await fetch("/api/driver/offline", {
      method: body ? "POST" : "GET",
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
      credentials: "same-origin",
      cache: "no-store",
      signal: controller.signal,
    });
    const data = await r.json().catch(() => null);
    if (!r.ok)
      throw new SyncError(
        data?.code ?? "TEMPORARY",
        data?.message ??
          "The server could not be reached. Saved records will retry.",
        r.status,
      );
    if (!data)
      throw new SyncError(
        "TEMPORARY",
        "Server confirmation did not match. The record remains on this device.",
      );
    return data as T;
  } catch (error) {
    if (error instanceof SyncError) throw error;
    if (controller.signal.aborted)
      throw new SyncError(
        "TEMPORARY",
        "The server could not be reached. Saved records will retry.",
        503,
      );
    throw new SyncError(
      "NETWORK",
      "Network unavailable. Saved records will retry when connected.",
    );
  } finally {
    clearTimeout(timer);
  }
}
export type SyncView = {
  connection: "Online" | "Offline";
  status: string;
  message?: string;
};
export class SyncController {
  running = false;
  stopped = false;
  constructor(
    readonly vault: OfflineVault,
    readonly notify: (view: SyncView) => void,
    readonly changed: (state: LocalState) => void,
    readonly request = offlineRequest,
  ) {}
  async run(manual = false) {
    if (this.running || this.stopped) return;
    this.running = true;
    const lock = async (browserLockHeld = false) => {
      const lease = crypto.randomUUID(),
        key = `sync:${this.vault.id}`,
        db = this.vault.db;
      const acquired = await db.transaction("rw", db.leases, async () => {
        const old = await db.leases.get(key);
        // An exclusive Web Lock is released by the browser when its tab dies.
        // Once we hold it, any leftover database lease belongs to that dead
        // controller. Waiting for its timeout can strand reload/reconnect sync.
        // Browsers without Web Locks still require the durable lease timeout.
        if (!browserLockHeld && old && old.expires > Date.now()) return false;
        await db.leases.put({ key, owner: lease, expires: Date.now() + 30000 });
        return true;
      });
      if (!acquired) return;
      const heartbeat = setInterval(() => {
        void db
          .transaction("rw", db.leases, async () => {
            const old = await db.leases.get(key);
            if (old?.owner === lease)
              await db.leases.put({ ...old, expires: Date.now() + 30000 });
          })
          .catch(() => {});
      }, 10000);
      try {
        await this.synchronize(manual);
      } finally {
        clearInterval(heartbeat);
        await db.transaction("rw", db.leases, async () => {
          if ((await db.leases.get(key))?.owner === lease)
            await db.leases.delete(key);
        });
      }
    };
    try {
      if (typeof navigator !== "undefined" && navigator.locks)
        await navigator.locks.request(
          `mk:${this.vault.id}`,
          { ifAvailable: true },
          async (token) => {
            if (token) await lock(true);
          },
        );
      else await lock();
    } catch (error) {
      this.notify({
        connection: "Offline",
        status: "Sync Failed",
        message:
          error instanceof Error
            ? error.message
            : "Device records could not be read or saved. Do not clear browser data.",
      });
    } finally {
      this.running = false;
    }
  }
  private async synchronize(manual: boolean) {
    let state = await this.vault.read();
    const args = {
      trip: state.snapshot.round.trip_id,
      device: state.device,
      token: state.token,
    };
    try {
      const identity = await this.request<{ profile: { id: string } }>();
      if (identity.profile.id !== state.user)
        throw new SyncError(
          "AUTHENTICATION",
          "Sign in as the owner of these device records before synchronization.",
          401,
        );
      this.notify({ connection: "Online", status: "Syncing" });
      const server = await this.request<{
        round: DeviceRound;
        receipts: Receipt[];
      }>({
        ...args,
        action: "checkin",
        pending: state.operations.filter((o) => o.status !== "SYNCED").length,
      });
      // Query committed results FIRST: a lost response must not produce another effect.
      for (const op of state.operations.filter((o) => o.status !== "SYNCED")) {
        const receipt = server.receipts.find((r) => r.id === op.id);
        if (receipt?.status === "CONFIRMED")
          await this.vault.acknowledge(op, receipt);
        else if (
          receipt?.status === "RETRYABLE" ||
          (manual && !receipt && op.status === "NEEDS_REVIEW")
        )
          await this.vault.mutate((s) => {
            const o = s.operations.find((o) => o.id === op.id)!;
            o.status = "PENDING";
            o.retryAt = 0;
            o.message = undefined;
            s.recovery.push({
              at: new Date().toISOString(),
              operation: op.id,
              action: "Authorized retry with original operation ID and payload",
            });
          });
      }
      while (!this.stopped) {
        state = await this.vault.read();
        const op = state.operations.find((o) => o.status !== "SYNCED");
        if (
          !op ||
          op.status === "NEEDS_REVIEW" ||
          (!manual && op.retryAt > Date.now())
        )
          break;
        try {
          const receipt = await this.request<Receipt>({
            ...args,
            action: "post",
            operation: {
              version: op.version,
              id: op.id,
              trip: op.trip,
              sequence: op.sequence,
              kind: op.kind,
              occurredAt: op.occurredAt,
              payload: op.payload,
              fingerprint: op.fingerprint,
            },
          });
          if (receipt.status === "CONFIRMED") {
            confirmAcknowledgement(op, receipt);
            this.changed(await this.vault.acknowledge(op, receipt));
          } else {
            await this.vault.mutate((s) => {
              const o = s.operations.find((o) => o.id === op.id)!;
              o.status = "NEEDS_REVIEW";
              o.message =
                receipt.message ??
                "The saved record needs review. Keep it on this device and contact the warehouse admin.";
            });
            break;
          }
        } catch (error) {
          const permanent =
            error instanceof SyncError
              ? [400, 403, 409, 413].includes(error.status)
              : true;
          await this.vault.mutate((s) => {
            const o = s.operations.find((o) => o.id === op.id)!;
            o.attempts++;
            o.retryAt = Date.now() + retryDelay(o.attempts);
            o.message = error instanceof Error ? error.message : "Sync Failed";
            if (permanent) o.status = "NEEDS_REVIEW";
          });
          throw error;
        }
      }
      state = await this.vault.read();
      const pendingNow = state.operations.filter(
        (o) => o.status !== "SYNCED",
      ).length;
      if (pendingNow !== server.round.reported_pending) {
        await this.request({ ...args, action: "checkin", pending: pendingNow });
      }
      if (
        ["PREPARED", "ACTIVE", "PAUSED"].includes(state.snapshot.round.phase)
      ) {
        try {
          const snapshot = await this.request<OfflineSnapshot>({
            ...args,
            action: "snapshot",
          });
          state = await this.vault.installSnapshot(snapshot);
        } catch (error) {
          if (
            !(error instanceof SyncError) ||
            !state.operations.some((o) => o.status !== "SYNCED")
          )
            throw error;
        }
      }
      this.changed(state);
      this.notify({
        connection: "Online",
        status: state.operations.some((o) => o.status === "NEEDS_REVIEW")
          ? "Needs Review"
          : state.operations.some((o) => o.status !== "SYNCED")
            ? "Waiting to Sync"
            : "All Synced",
      });
    } catch (error) {
      if (error instanceof SyncError && error.status === 403)
        await this.vault.mutate((s) => {
          s.snapshot.authorizedUntil = new Date(0).toISOString();
          const o = s.operations.find((o) => o.status !== "SYNCED");
          if (o) {
            o.status = "NEEDS_REVIEW";
            o.message = error.message;
          }
        });
      this.changed(await this.vault.read());
      this.notify({
        connection:
          error instanceof SyncError && error.status && error.code !== "NETWORK"
            ? "Online"
            : "Offline",
        status:
          error instanceof SyncError && error.status === 403
            ? "Needs Review"
            : "Sync Failed",
        message: error instanceof Error ? error.message : "Sync Failed",
      });
    }
  }
}
