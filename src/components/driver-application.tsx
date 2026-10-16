"use client";
import { useEffect, useRef, useState, useMemo, Suspense } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import Dexie from "dexie";
import type { Profile } from "@/domain/auth/roles";
import type { Locale } from "@/domain/localization/locale";
import type { Workspace, Trip } from "@/domain/operations/types";
import type { FinanceWorkspace } from "@/domain/finance/types";
import type { PendingJarWorkspace } from "@/domain/operations/pending-jars";
import type {
  LocalState,
  OfflineSnapshot,
  DeliveryDraft,
  CollectionDraft,
} from "@/domain/offline/types";
import {
  projectedWorkspace,
  projectedCustomer,
} from "@/domain/offline/projection";
import {
  invoiceTotal,
  effectivePrice,
  resolvedCustomer,
} from "@/domain/offline/operations";
import {
  connectivityFailure,
  type Connectivity,
} from "@/domain/offline/connectivity";
import {
  offlineDB,
  OfflineVault,
  OfflineLocalDataError,
  storageMessage,
} from "@/lib/offline/store";
import {
  getAutomaticDeviceSecrets,
  createAutomaticDeviceSecrets,
  requireDeviceSignIn,
} from "@/lib/offline/device";
import {
  SyncController,
  SyncError,
  offlineRequest,
  type SyncView,
} from "@/lib/offline/sync";
import { fetchCustomerContext } from "@/lib/customers/request";
import { CustomerLookupError } from "@/domain/operations/customer-errors";
import { cents } from "@/domain/finance/money";
import {
  driverOperationAction,
  type OperationState,
} from "@/app/operations-actions";
import {
  DriverRuntimeContext,
  driverPaths,
  offlinePreparingMessage,
  type OfflinePrepState,
} from "./driver-runtime-context";
import { LocaleProvider, LanguageSwitcher, T, Message } from "./localization";
import { Navigation } from "./navigation";
import { Button } from "./ui/button";
import { SignOutButton } from "./sign-out-button";
import { DriverHomeView } from "./driver-home-view";
import { DriverSalesView } from "./driver-sales-view";
import { DriverCustomers } from "./driver-customers";
import { DeliveryForm, ReturnForm } from "./trip-forms";
import { CollectCreditForm } from "./finance-payment";
import { DriverStock } from "./driver-stock";
import { OfflineCustomers, OfflineReturnForm } from "./offline/workspace";
import { OfflineHistory } from "./offline/views";
import { OfflineCollection } from "./offline/collection";
import { DriverPendingJars } from "./driver-pending-jars";
import { InstantDriver } from "./instant-delivery";
import type { InstantWorkspace } from "@/domain/instant";
import { projectedInstants } from "@/domain/offline/instant";
import { prepareOfflineShell } from "./offline/registration";
import { Card } from "./ui/card";
import { NotificationBell, LockedNotificationBell } from "./notification-bell";

export type DriverData = {
  eligibleTrips?: Trip[];
  tripChoiceRequired?: boolean;
  instant?: InstantWorkspace;
  profile: Profile;
  locale: Locale;
  round: { trip_id: string; phase: string } | null;
  overview: Workspace;
  workspace: Workspace;
  finance: FinanceWorkspace;
  trip?: Trip;
  day?: Workspace["days"][number];
  dayOpen: boolean;
  delivering: boolean;
  pending: PendingJarWorkspace;
  history: Trip[] | null;
};
async function readWorkspace(query: string): Promise<DriverData> {
  const abort = new AbortController(),
    timer = setTimeout(() => abort.abort(), 15000);
  try {
    const response = await fetch(`/api/driver/workspace?${query}`, {
      cache: "no-store",
      credentials: "same-origin",
      signal: abort.signal,
    });
    const data = await response.json().catch(() => null);
    if (!response.ok)
      throw new SyncError(
        data?.code ?? "TEMPORARY",
        data?.message ??
          "The server could not be reached. Saved records will retry.",
        response.status,
      );
    if (!data?.profile || !data?.workspace)
      throw new SyncError(
        "TEMPORARY",
        "Server confirmation did not match. The record remains on this device.",
        502,
      );
    return data;
  } catch (error) {
    if (error instanceof SyncError) throw error;
    if (abort.signal.aborted)
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
export function DriverApplication(props: {
  profile?: Profile;
  locale?: Locale;
  children?: React.ReactNode;
}) {
  return (
    <Suspense
      fallback={
        <p>
          <Message value="Loading workspace…" />
        </p>
      }
    >
      <Application {...props} />
    </Suspense>
  );
}
function Application({
  profile: initialProfile,
  locale: initialLocale = "ne",
  children,
}: {
  profile?: Profile;
  locale?: Locale;
  children?: React.ReactNode;
}) {
  const pathname = usePathname(),
    params = useSearchParams();
  const [data, setData] = useState<DriverData>(),
    [state, setState] = useState<LocalState>();
  const [mode, setMode] = useState<Connectivity>("CHECKING"),
    [message, setMessage] = useState("");
  const [connectionMessage, setConnectionMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<
    { id: string; trip: string; pending: number; review: number }[]
  >([]);
  const [deviceChecked, setDeviceChecked] = useState(false);
  const [signedOut, setSignedOut] = useState(false);
  const signedOutRef = useRef(false);
  const opening = useRef<Promise<void> | undefined>(undefined);
  const [offlinePrepState, setOfflinePrepState] =
    useState<OfflinePrepState>("IDLE");
  const offlinePrepRef = useRef<OfflinePrepState>("IDLE");
  function updateOfflinePrepState(next: OfflinePrepState) {
    offlinePrepRef.current = next;
    setOfflinePrepState(next);
  }
  const [view, setView] = useState<SyncView>({
    connection: "Online",
    status: "Checking server connectivity",
  });
  const [notice, setNotice] = useState(""),
    [epoch, setEpoch] = useState(0);
  const database = useMemo(() => offlineDB(), []);
  const vault = useRef<OfflineVault | undefined>(undefined),
    controller = useRef<SyncController | undefined>(undefined);
  const modeRef = useRef(mode),
    dataRef = useRef(data),
    generation = useRef(0),
    querying = useRef<Promise<Connectivity> | undefined>(undefined);
  const probeSequence = useRef(0);
  const saving = useRef(false);
  const queryRef = useRef(params.toString());
  const localeRef = useRef(initialLocale);
  const selectedLocale = useRef(false);
  const shellPrepared = useRef(false);
  const mounted = useRef(false);
  const profile = state?.snapshot.profile ?? data?.profile ?? initialProfile;
  const profileRef = useRef(profile);
  useEffect(() => {
    queryRef.current = params.toString();
    profileRef.current = profile;
    modeRef.current = mode;
    dataRef.current = data;
  }, [params, profile, mode, data]);
  async function loadRows() {
    const current = generation.current;
    try {
      const user = (await database.settings.get("active-user"))?.value;
      if (!user || (profileRef.current && profileRef.current.id !== user)) {
        if (current === generation.current) setDeviceChecked(true);
        return;
      }
      const values = await database.vaults
        .where("user")
        .equals(user)
        .sortBy("updated");
      if (current === generation.current) {
        setDeviceChecked(true);
        setRows(values);
      }
    } catch (error) {
      if (current === generation.current) setMessage(storageMessage(error));
    }
  }
  async function probe(force = false): Promise<Connectivity> {
    // Explicit sign-out stays effective until normal Supabase sign-in mounts a
    // new workspace. A delayed logout must not let a poll restore local access.
    if (signedOutRef.current) return "AUTHENTICATION";
    if (querying.current && !force) return querying.current;
    const current = generation.current;
    const sequence = ++probeSequence.current;
    const request = (async () => {
      try {
        const result = await readWorkspace(queryRef.current);
        if (
          current !== generation.current ||
          sequence !== probeSequence.current
        )
          return modeRef.current;
        // Device storage failures do not change a successful connectivity check.
        // Release a fully acknowledged, sealed round when the next load arrives.
        const writer = vault.current;
        if (writer) {
          if (!writer.id.startsWith(result.profile.id + ":")) {
            if (controller.current) controller.current.stopped = true;
            controller.current = undefined;
            vault.current = undefined;
            updateOfflinePrepState("IDLE");
            setState(undefined);
            setRows([]);
          }
          try {
            const local = await writer.read();
            if (
              current !== generation.current ||
              sequence !== probeSequence.current
            )
              return modeRef.current;
            if (
              local.user !== result.profile.id ||
              (local.sealed &&
                local.operations.every((o) => o.status === "SYNCED") &&
                result.trip &&
                result.trip.id !== local.snapshot.round.trip_id)
            ) {
              if (controller.current) controller.current.stopped = true;
              controller.current = undefined;
              vault.current = undefined;
              updateOfflinePrepState("IDLE");
              setState(undefined);
              setNotice("");
            }
          } catch (error) {
            if (current === generation.current)
              setMessage(storageMessage(error));
          }
        }
        dataRef.current = result;
        setData(result);
        setMode("ONLINE");
        modeRef.current = "ONLINE";
        setConnectionMessage("");
        try {
          await database.transaction("rw", database.settings, async () => {
            if (current !== generation.current) return;
            await requireDeviceSignIn(database, result.profile.id, false);
            await database.settings.put({
              key: "active-user",
              value: result.profile.id,
            });
            if (current !== generation.current)
              throw new Error(
                "Sign in online again. Your saved changes are on this phone.",
              );
          });
        } catch (error) {
          if (current === generation.current) setMessage(storageMessage(error));
        }
        await loadRows();
        return "ONLINE" as const;
      } catch (error) {
        if (
          current !== generation.current ||
          sequence !== probeSequence.current
        )
          return modeRef.current;
        const next = connectivityFailure(
          error instanceof SyncError ? error : {},
        );
        modeRef.current = next;
        setMode(next);
        if (next === "OFFLINE")
          setView({ connection: "Offline", status: "Waiting to Sync" });
        setConnectionMessage(
          error instanceof Error
            ? error.message
            : "The server could not be reached. Saved records will retry.",
        );
        if (next === "AUTHORIZATION") {
          const writer = vault.current;
          if (writer) {
            const expired = await writer
              .mutate((s) => {
                s.snapshot.authorizedUntil = new Date(0).toISOString();
              })
              .catch(() => undefined);
            if (
              current === generation.current &&
              vault.current === writer &&
              expired
            )
              setState(expired);
          }
          if (next === "AUTHORIZATION") {
            setData(undefined);
            dataRef.current = undefined;
          }
        }
        await loadRows();
        return next;
      }
    })();
    querying.current = request;
    try {
      return await request;
    } finally {
      if (querying.current === request) querying.current = undefined;
    }
  }
  useEffect(() => {
    mounted.current = true;
    let disposed = false;
    const refresh = async (event?: Event) => {
      if (event?.type === "offline") {
        probeSequence.current++;
        modeRef.current = "OFFLINE";
        setMode("OFFLINE");
        setConnectionMessage("");
        return;
      }
      const connection = await probe(event?.type === "online");
      if (!disposed && connection === "ONLINE") await controller.current?.run();
    };
    const load = () => {
      void loadRows();
      const current = generation.current,
        writer = vault.current;
      if (writer)
        void writer
          .read()
          .then((s) => {
            if (current === generation.current && vault.current === writer)
              setState(s);
          })
          .catch((e) => setMessage(storageMessage(e)));
    };
    const lock = () => {
      generation.current++;
      if (controller.current) controller.current.stopped = true;
      controller.current = undefined;
      vault.current = undefined;
      updateOfflinePrepState("IDLE");
      signedOutRef.current = true;
      setSignedOut(true);
      setState(undefined);
      setData(undefined);
      dataRef.current = undefined;
      setRows([]);
      selectedLocale.current = false;
      setMode("AUTHENTICATION");
      modeRef.current = "AUTHENTICATION";
      setMessage("Sign in online again. Your saved changes are on this phone.");
      void loadRows();
    };
    const channel = new BroadcastChannel("mk-offline-session");
    channel.onmessage = lock;
    const customerChannel = new BroadcastChannel("mk-customer-confirmed");
    customerChannel.onmessage = refresh;
    window.addEventListener("online", refresh);
    window.addEventListener("offline", refresh);
    window.addEventListener("focus", refresh);
    window.addEventListener("mk-offline-changed", load);
    window.addEventListener("mk-offline-locked", lock);
    window.addEventListener("mk-customer-confirmed", refresh);
    window.addEventListener("operation-saved", refresh);
    const visible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const localeChanged = (event: Event) => {
      const locale = (event as CustomEvent<Locale>).detail;
      if (locale === "en" || locale === "ne") {
        localeRef.current = locale;
        selectedLocale.current = true;
      }
      const writer = vault.current,
        current = generation.current;
      if (writer && (locale === "en" || locale === "ne"))
        void writer
          .mutate((s) => {
            s.locale = locale;
          })
          .then((s) => {
            if (current === generation.current && vault.current === writer)
              setState(s);
          })
          .catch((error) => {
            if (current === generation.current)
              setMessage(storageMessage(error));
          });
    };
    window.addEventListener("mk-locale-selected", localeChanged);
    document.addEventListener("visibilitychange", visible);
    Dexie.on("storagemutated", load);
    const timer = setInterval(visible, 5000);
    // React's development Strict Mode replays effect setup/cleanup. Reopen the
    // same Dexie connection before starting requests after that replay.
    void database
      .open()
      .catch((error) => {
        if (!disposed) setMessage(storageMessage(error));
      })
      .then(async () => {
        if (!disposed) {
          await loadRows();
          // Restore IndexedDB independently of the network probe, including when
          // the network claims to be online but the workspace request hangs.
          void prepareOrOpenOfflineTrip(true);
          void refresh();
        }
      });
    return () => {
      disposed = true;
      mounted.current = false;
      // Invalidate asynchronous reads, not a DOM ref captured at mount.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      generation.current++;
      querying.current = undefined;
      opening.current = undefined;
      clearInterval(timer);
      if (controller.current) controller.current.stopped = true;
      channel.close();
      customerChannel.close();
      window.removeEventListener("online", refresh);
      window.removeEventListener("offline", refresh);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("mk-offline-changed", load);
      window.removeEventListener("mk-offline-locked", lock);
      window.removeEventListener("mk-customer-confirmed", refresh);
      window.removeEventListener("operation-saved", refresh);
      window.removeEventListener("mk-locale-selected", localeChanged);
      document.removeEventListener("visibilitychange", visible);
      Dexie.on("storagemutated").unsubscribe(load);
      // Keep the connection during React's immediate effect replay. Close it
      // after a genuine unmount; stale callbacks are still generation-guarded.
      queueMicrotask(() => {
        if (!mounted.current) database.close();
      });
    };
    // The dashboard owns one key and controller for its entire mounted session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [database]);
  useEffect(() => {
    void probe(true);
    // Query filters change authoritative history without remounting drafts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, params]);
  useEffect(() => {
    if (mode !== "ONLINE" || !rows.length || shellPrepared.current) return;
    shellPrepared.current = true;
    const current = generation.current;
    void prepareOfflineShell().catch(() => {
      shellPrepared.current = false;
      if (current === generation.current)
        setNotice(
          "Offline data could not be prepared. Please reconnect and try again.",
        );
    });
  }, [mode, rows.length]);
  useEffect(() => {
    if (
      mode === "ONLINE" &&
      data?.profile.approval_status === "APPROVED" &&
      data.profile.is_active &&
      data.trip &&
      (data.delivering || ["LOADED", "ACTIVE"].includes(data.trip.status)) &&
      !vault.current &&
      offlinePrepState === "IDLE" &&
      deviceChecked &&
      !signedOutRef.current
    )
      void prepareOrOpenOfflineTrip();
    // Failed preparation waits for Retry; polling must not replace the failure
    // status or repeatedly register while the driver is editing a draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, data, deviceChecked, offlinePrepState]);
  async function refreshSnapshot() {
    const writer = vault.current,
      current = generation.current;
    if (!writer) {
      await probe();
      return;
    }
    const local = await writer.read();
    const snapshot = await offlineRequest<OfflineSnapshot>({
      action: "snapshot",
      trip: local.snapshot.round.trip_id,
      device: local.device,
      token: local.token,
    });
    const next = await writer.installSnapshot(snapshot);
    if (current === generation.current && vault.current === writer)
      setState(next);
  }
  async function deviceRequest<T>(body: Record<string, unknown>): Promise<T> {
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), 15000);
    try {
      const response = await fetch("/api/driver/device", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: abort.signal,
      });
      const value = await response.json();
      if (!response.ok)
        throw new SyncError(value.code, value.message, response.status);
      return value;
    } finally {
      clearTimeout(timeout);
    }
  }
  function prepareOrOpenOfflineTrip(localOnly = false): Promise<void> {
    if (opening.current) return opening.current;
    if (vault.current || signedOutRef.current) return Promise.resolve();
    const current = generation.current;
    let pendingOnPhone = 0;
    updateOfflinePrepState("PREPARING");
    setMessage("");
    const activate = async () => {
      if (current !== generation.current || signedOutRef.current) return;
      const user = (await database.settings.get("active-user"))?.value;
      const d = dataRef.current;
      if (!user || (profileRef.current && profileRef.current.id !== user))
        return;
      const copies = await database.vaults
        .where("user")
        .equals(user)
        .sortBy("updated");
      pendingOnPhone = copies.reduce((count, row) => count + row.pending, 0);
      const candidate =
        copies.find((r) => r.pending > 0) ??
        copies.find((r) => r.trip === d?.trip?.id) ??
        copies.at(-1);
      const id =
        !localOnly && d?.trip && !candidate?.pending
          ? `${user}:${d.trip.id}`
          : candidate?.id;
      if (!id || (localOnly && !candidate)) return;
      const tripId = id.slice(user.length + 1);
      const existing = await database.vaults.get(id);
      let secrets = await getAutomaticDeviceSecrets(database, user);
      if (current !== generation.current || signedOutRef.current) return;
      let opened: OfflineVault | undefined;
      if (existing && secrets) {
        try {
          opened = await OfflineVault.unlock(database, id, secrets.secret);
        } catch (error) {
          if (!(error instanceof OfflineLocalDataError)) throw error;
          if (existing.pending !== 0 || existing.review !== 0) throw error;
        }
      }
      if (
        existing &&
        !opened &&
        (existing.pending !== 0 || existing.review !== 0)
      )
        throw new OfflineLocalDataError(
          "RECORDS",
          "Local pending records need admin help.",
        );
      if (!opened) {
        // An old setup cannot be opened with a newly generated automatic key.
        // Only a zero-pending copy can be rebuilt online, after server approval;
        // create() archives the old bytes atomically instead of discarding them.
        if (localOnly) return;
        if (modeRef.current !== "ONLINE")
          throw new SyncError("NETWORK", "Offline preparation needs internet.");
        if (
          !d?.trip ||
          d.profile.id !== user ||
          d.profile.approval_status !== "APPROVED" ||
          !d.profile.is_active ||
          !["LOADED", "ACTIVE"].includes(d.trip.status)
        )
          return;
        secrets ??= await createAutomaticDeviceSecrets(database, user);
        // Persist credentials before any request whose response can be lost.
        const credentials = await OfflineVault.prepare(
          database,
          user,
          tripId,
          secrets.secret,
          secrets,
          true,
        );
        await deviceRequest({
          action: "automatic-register",
          trip: tripId,
          ...credentials,
        });
        await prepareOfflineShell();
        shellPrepared.current = true;
        const snapshot = await offlineRequest<OfflineSnapshot>({
          action: "register",
          trip: tripId,
          ...credentials,
        });
        if (current !== generation.current) return;
        snapshot.locale = localeRef.current;
        opened = await OfflineVault.create(
          database,
          snapshot,
          credentials.device,
          credentials.token,
          secrets.secret,
          existing,
        );
        void navigator.storage?.persist?.().catch(() => false);
      }
      if (current !== generation.current) return;
      const local = selectedLocale.current
        ? await opened.mutate((s) => {
            s.locale = localeRef.current;
          })
        : await opened.read();
      if (current !== generation.current) return;
      if (
        local.user !== user ||
        (dataRef.current && dataRef.current.profile.id !== user)
      )
        throw new Error("Sign in as the driver who saved these changes.");
      vault.current = opened;
      setState(local);
      updateOfflinePrepState("READY");
      window.dispatchEvent(
        new CustomEvent("mk-locale-restored", { detail: local.locale }),
      );
      if (controller.current) controller.current.stopped = true;
      controller.current = new SyncController(
        opened,
        (v) => {
          if (current === generation.current && vault.current === opened)
            setView(v);
        },
        (s) => {
          if (current === generation.current && vault.current === opened)
            setState(s);
        },
      );
      await loadRows();
      if (modeRef.current === "ONLINE") void controller.current.run();
      else if (!navigator.onLine) {
        modeRef.current = "OFFLINE";
        setMode("OFFLINE");
      }
    };
    const task = (async () => {
      try {
        // One activation across tabs; the second tab re-reads the durable copy.
        if (navigator.locks)
          await navigator.locks.request("mk:offline-prepare", activate);
        else await activate();
      } catch (error) {
        if (current === generation.current) {
          updateOfflinePrepState("FAILED");
          setMessage(
            error instanceof SyncError
              ? error.code === "DEVICE_RESET_REQUIRED"
                ? "This trip is linked to another phone. Ask the warehouse admin to reset offline access."
                : error.code === "MIGRATION_REQUIRED"
                  ? "Offline access needs an update. Ask the warehouse admin."
                  : error.code === "NETWORK"
                    ? "Offline data could not be prepared. Please reconnect and try again."
                    : "Offline data could not be prepared. Please contact the admin if this continues."
              : error instanceof OfflineLocalDataError
                ? pendingOnPhone > 0
                  ? "Saved records on this phone need help from the admin. Keep this app's data."
                  : "Offline data could not be prepared. Please reconnect and try again."
                : storageMessage(error),
          );
        }
      }
    })().finally(() => {
      if (opening.current === task) opening.current = undefined;
      // A local-only restore with no saved trip leaves startup free to prepare
      // the online trip, even if its probe finished during this same promise.
      if (
        current === generation.current &&
        offlinePrepRef.current === "PREPARING"
      )
        updateOfflinePrepState("IDLE");
    });
    opening.current = task;
    return task;
  }
  async function record(
    kind: Parameters<OfflineVault["record"]>[0],
    draft: unknown,
    id = crypto.randomUUID(),
  ) {
    if (saving.current) throw new Error("Saving…");
    saving.current = true;
    setBusy(true);
    setNotice("");
    setMessage("");
    const writer = vault.current,
      current = generation.current,
      synchronizer = controller.current;
    try {
      if (!writer) {
        throw new Error(offlinePreparingMessage);
      }
      if (
        ["AUTHENTICATION", "AUTHORIZATION", "DATABASE"].includes(
          modeRef.current,
        )
      )
        throw new Error(
          connectionMessage ||
            "Sign in online again. Device records are preserved.",
        );
      let local = await writer.read();
      if (!local.operations.some((o) => o.id === id))
        local = await writer.record(kind, draft, id);
      if (current === generation.current && vault.current === writer)
        setState(local);
      // The durable journal commit is the success boundary. Upload happens
      // independently and always reuses this operation's UUID and payload.
      if (current === generation.current && modeRef.current === "ONLINE")
        void synchronizer?.run();
      if (current === generation.current) setNotice("Saved on phone");
      return "Saved on phone";
    } finally {
      saving.current = false;
      if (current === generation.current) setBusy(false);
    }
  }
  const runtime = {
    offlinePrepState,
    revision: JSON.stringify(
      state
        ? [
            state.snapshot.contexts,
            state.snapshot.workspace.products,
            state.snapshot.round.confirmed_sequence,
            state.operations.map((o) => [
              o.id,
              o.status,
              o.acknowledgement?.customer,
            ]),
          ]
        : [],
    ),
    cachedCustomer: (id: string) => {
      try {
        return state ? projectedCustomer(state, id) : undefined;
      } catch {
        return undefined;
      }
    },
    async customer(trip: string, id: string, signal: AbortSignal) {
      if (vault.current) {
        const local = await vault.current.read();
        try {
          if (modeRef.current === "ONLINE")
            void refreshSnapshot().catch(() => {});
          return projectedCustomer(local, id);
        } catch {
          /* fetch missing context online */
        }
      }
      if (modeRef.current === "OFFLINE")
        throw new Error("Connect to internet once before starting this trip.");
      try {
        const local = vault.current ? await vault.current.read() : undefined;
        const resolved = local ? resolvedCustomer(local, id)! : id;
        if (
          local &&
          !local.snapshot.contexts.some((c) => c.customer.id === resolved) &&
          local.operations.some(
            (o) => o.kind === "CUSTOMER" && JSON.parse(o.payload).id === id,
          )
        )
          return projectedCustomer(local, id);
        const result = await fetchCustomerContext(trip, resolved, signal);
        if (vault.current) {
          await refreshSnapshot();
          return projectedCustomer(await vault.current.read(), id);
        }
        return result.data;
      } catch (error) {
        if (error instanceof CustomerLookupError && error.code === "NETWORK") {
          if ((await probe()) === "OFFLINE" && vault.current)
            return projectedCustomer(await vault.current.read(), id);
        }
        throw error;
      }
    },
    async submit(form: FormData): Promise<OperationState> {
      try {
        if (signedOutRef.current)
          throw new Error(
            "Sign in online again. Your saved changes are on this phone.",
          );
        const operation = String(form.get("operation")),
          id = String(form.get("key"));
        // UI gating is also enforced here for stale/programmatic submissions.
        // Never wait for preparation inside a delivery save or touch its draft.
        if (
          ["driver-visit", "instant"].includes(operation) &&
          (offlinePrepRef.current !== "READY" || !vault.current)
        )
          return { error: offlinePreparingMessage };
        if (!vault.current) {
          if (!["start", "continue"].includes(operation))
            return { error: offlinePreparingMessage };
          if (modeRef.current !== "ONLINE")
            throw new Error("Connect to internet to start this trip.");
          let result: OperationState;
          try {
            result = await driverOperationAction(null, form);
          } catch (error) {
            if ((await probe(true)) === "OFFLINE")
              throw new Error(
                "Connect to internet once before starting this trip.",
              );
            throw error;
          }
          if (
            result?.error ===
            "Use the registered offline device for this delivery round."
          ) {
            await probe(true);
            return {
              error: offlinePreparingMessage,
            };
          }
          if (result?.error && (await probe(true)) === "OFFLINE") {
            return {
              error: "Connect to internet once before starting this trip.",
            };
          }
          if (result?.success) {
            if (operation === "start" || operation === "submit")
              setNotice("Record saved.");
            // A request begun before this write can contain stale inventory or
            // ACTIVE status. Fetch a newer version before presenting success.
            await probe(true);
            return { ...result, success: "Record saved." };
          }
          return result;
        }
        const local = await vault.current.read();
        if (String(form.get("trip")) !== local.snapshot.round.trip_id)
          throw new Error("Open the trip that is saved on this phone.");
        let success: string;
        if (operation === "driver-visit" || operation === "instant") {
          const items = JSON.parse(
            String(form.get("items")),
          ) as DeliveryDraft["items"];
          const instant =
            operation === "instant"
              ? {
                  id: String(form.get("id")),
                  name: String(form.get("event_name")),
                  phone: String(form.get("phone")),
                  location: String(form.get("location")),
                }
              : undefined;
          const customer =
            instant?.id ?? (String(form.get("customer") ?? "") || null);
          const total = invoiceTotal(
            local,
            items.reduce(
              (n, i) =>
                n +
                cents(effectivePrice(local, customer, i.product_id)) *
                  BigInt(i.full_jars + i.cartons),
              0n,
            ),
          );
          if (form.get("reviewed_total") !== total)
            throw new Error(
              "Customer data changed. Refresh the confirmed details and review this delivery.",
            );
          success = await record(
            instant ? "INSTANT" : "DELIVERY",
            {
              customer,
              ...(instant ? { instant } : {}),
              items,
              walk_name: String(form.get("walk_name") ?? ""),
              walk_phone: String(form.get("walk_phone") ?? ""),
              notes: instant ? String(form.get("notes") ?? "") : "",
              status: String(form.get("payment_status")),
              received: String(form.get("received_amount") ?? "") || null,
              total: invoiceTotal(
                local,
                items.reduce(
                  (n, i) =>
                    n +
                    cents(effectivePrice(local, customer, i.product_id)) *
                      BigInt(i.full_jars + i.cartons),
                  0n,
                ),
              ),
              prices: [],
              custody: [],
            },
            id,
          );
        } else if (operation === "finance:PAYMENT") {
          const payment = JSON.parse(
            String(form.get("payment_data")),
          ) as CollectionDraft;
          success = await record(
            "PAYMENT",
            {
              customer: String(form.get("customer")),
              method: payment.method,
              amount: payment.amount,
              reference: payment.reference ?? "",
              allocations: payment.allocations,
              deposit_amount: payment.deposit_amount ?? "0",
              current_amount: "0.00",
            },
            id,
          );
        } else if (
          ["delivery-contact", "delivery-customer"].includes(operation)
        ) {
          const draft = Object.fromEntries(
            [
              "id",
              "name",
              "shop_name",
              "phone",
              "address",
              "supply_type",
              "contact_person",
              "customer_type",
              "delivery_notes",
            ].map((k) => [k, String(form.get(k) ?? "")]),
          );
          success = await record(
            Number(form.get("version")) > 0 ? "CONTACT" : "CUSTOMER",
            { ...draft, version: Number(form.get("version")) },
            id,
          );
        } else if (operation === "pause") {
          success = await record("PAUSE", { manifest: [] }, id);
        } else if (operation === "submit") {
          success = await record(
            "SUBMIT",
            {
              counts: JSON.parse(String(form.get("counts"))),
              manifest: [],
            },
            id,
          );
        } else {
          if (modeRef.current !== "ONLINE")
            throw new Error(
              "This action requires server confirmation. Your saved records remain on this device.",
            );
          const result = await driverOperationAction(null, form);
          if (result?.success) {
            await controller.current?.run(true);
            if (["start", "continue"].includes(operation))
              await refreshSnapshot();
            await probe(true);
            if (["start", "continue"].includes(operation))
              setNotice("Record saved.");
          }
          return result?.success
            ? { ...result, success: "Record saved." }
            : result;
        }
        return { success, id: String(form.get("id") || id) };
      } catch (error) {
        return { error: storageMessage(error) };
      }
    },
    refresh: async () => {
      if ((await probe()) === "ONLINE") await refreshSnapshot();
    },
    next: () => {
      setEpoch((e) => e + 1);
      setNotice("");
      void probe();
    },
  };
  const projected = state ? projectedWorkspace(state) : undefined;
  const shown =
    !deviceChecked || signedOut
      ? undefined
      : data && !state
        ? data
        : state
          ? ({
              ...data,
              profile: state.snapshot.profile,
              locale: state.locale,
              round: state.snapshot.round,
              overview: data?.overview ?? projected!,
              workspace: projected!,
              finance: state.snapshot.finance,
              trip: projected!.trips.find(
                (t) => t.id === state.snapshot.round.trip_id,
              ),
              day: projected!.days.find((d) => d.status === "OPEN"),
              dayOpen: projected!.days.some((d) => d.status === "OPEN"),
              delivering:
                !state.sealed &&
                !state.paused &&
                state.snapshot.round.phase === "ACTIVE",
              history: data?.history ?? projected!.trips,
              pending: data?.pending,
              instant: projectedInstants(state),
              eligibleTrips: projected!.trips.filter(
                (t) => t.id === state.snapshot.round.trip_id,
              ),
              tripChoiceRequired: false,
            } as DriverData)
          : undefined;
  const path =
    pathname === "/offline" || pathname === "/" || pathname === "/sign-in"
      ? params.get("view") === "sale"
        ? "/driver/delivery"
        : params.get("view") === "return"
          ? "/driver/return"
          : "/driver/home"
      : pathname;
  const screen = driverPaths.includes(path);
  const pending =
    rows
      .filter(
        (r) =>
          r.id !==
          (state ? `${state.user}:${state.snapshot.round.trip_id}` : ""),
      )
      .reduce((n, r) => n + r.pending, 0) +
    (state ? state.operations.filter((o) => o.status !== "SYNCED").length : 0);
  const trip = shown?.trip;
  return (
    <LocaleProvider
      initialLocale={state?.locale ?? data?.locale ?? initialLocale}
      userId={profile?.id}
    >
      <DriverRuntimeContext.Provider value={screen ? runtime : null}>
        <div
          className="min-h-dvh pb-44 lg:pb-6"
          onClickCapture={(e) => {
            const link = (e.target as HTMLElement).closest("a");
            if (
              !link ||
              e.ctrlKey ||
              e.metaKey ||
              e.shiftKey ||
              e.altKey ||
              link.target ||
              link.hasAttribute("download")
            )
              return;
            const target = new URL(link.href, window.location.href);
            if (
              target.origin === window.location.origin &&
              driverPaths.includes(target.pathname)
            ) {
              e.preventDefault();
              window.history.pushState(
                null,
                "",
                target.pathname + target.search,
              );
            }
          }}
        >
          <header className="border-b bg-card p-4">
            <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-bold">
                  <T k="Mount Kailash" />
                </p>
                <p className="text-xs text-muted-foreground">
                  <T k="Driver Workspace" />
                </p>
                <a
                  href="/account/profile"
                  aria-label="My Profile"
                  className="underline"
                  data-testid="profile-name"
                >
                  {profile?.name}
                </a>
              </div>
              <LanguageSwitcher />
              {profile ? (
                <NotificationBell
                  key={profile.id}
                  profile={profile}
                  online={mode === "ONLINE"}
                  unlocked={
                    deviceChecked &&
                    !signedOut &&
                    mode !== "AUTHORIZATION" &&
                    (mode === "ONLINE" ||
                      !state ||
                      Date.now() < Date.parse(state.snapshot.authorizedUntil))
                  }
                  cache={state?.notifications}
                  persist={
                    state
                      ? async (notifications) => {
                          const active = vault.current;
                          if (!active || signedOut) return;
                          await active.mutate((local) => {
                            if (local.user === profile.id)
                              local.notifications = notifications;
                          });
                        }
                      : undefined
                  }
                />
              ) : (
                <LockedNotificationBell />
              )}
              {profile && <SignOutButton user={profile.id} driver />}
            </div>
            <div className="mx-auto max-w-7xl">
              <Navigation role="DRIVER" />
            </div>
          </header>
          <main
            id="main-content"
            className="mx-auto max-w-3xl space-y-5 p-5 sm:p-8"
          >
            <Card className="space-y-2" data-testid="driver-sync-status">
              <p>
                <T k={mode === "OFFLINE" ? "Offline" : "Online"} />
              </p>
              {(offlinePrepState === "READY" || pending > 0) && (
                <p role="status" data-testid="pending-sync-count">
                  {mode === "OFFLINE" ? (
                    <T k="{0} changes saved on this phone" values={[pending]} />
                  ) : view.status === "Sync Failed" ||
                    view.status === "Needs Review" ? (
                    <T k="Saved on phone" />
                  ) : pending ? (
                    <T k="Syncing {0} changes..." values={[pending]} />
                  ) : (
                    <T k="All synced" />
                  )}
                </p>
              )}
              {mode === "OFFLINE" && (
                <p>
                  <T k="They will sync automatically when internet returns." />
                </p>
              )}
              {mode !== "OFFLINE" &&
                (view.status === "Sync Failed" ||
                  view.status === "Needs Review") && (
                  <p>
                    <T k="We'll try again when internet is available." />
                  </p>
                )}
              {offlinePrepState === "PREPARING" && (
                <p role="status">
                  <T k="Preparing trip for offline use..." />
                </p>
              )}
              {offlinePrepState === "FAILED" && (
                <div role="alert" className="space-y-2">
                  <p>
                    <T k="Could not prepare offline data." />
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void prepareOrOpenOfflineTrip()}
                  >
                    <T k="Retry" />
                  </Button>
                </div>
              )}
              {offlinePrepState === "READY" && (
                <>
                  <p>
                    <span>
                      <T k="Offline ready" />
                    </span>{" "}
                    <span aria-hidden="true">✓</span>
                  </p>
                  <p>
                    <T k="You can continue deliveries without internet." />
                  </p>
                </>
              )}
            </Card>
            {message && (
              <p role="alert" className="rounded-lg bg-red-50 p-4 text-red-800">
                <Message value={message} />
              </p>
            )}
            {connectionMessage &&
              ["AUTHENTICATION", "AUTHORIZATION", "DATABASE"].includes(
                mode,
              ) && (
                <p role="alert" className="rounded-lg bg-amber-50 p-4">
                  <Message value={connectionMessage} />
                </p>
              )}
            {state?.sealed && (
              <p role="status">
                <T k="This delivery round is sealed. No new sales can be recorded." />
              </p>
            )}
            {state?.paused && (
              <p role="status">
                <T k="This trip is paused for carryover. Resume online after admin authorization." />
              </p>
            )}
            {notice && (
              <p role="status" className="rounded-lg bg-teal-50 p-4">
                <Message value={notice} />
              </p>
            )}
            {shown && screen ? (
              <>
                {path === "/driver/home" && <DriverHomeView data={shown} />}
                {path === "/driver/delivery" && (
                  <>
                    <h1 className="text-3xl font-bold">
                      <T k="New Sale" />
                    </h1>
                    {trip && shown.delivering ? (
                      <>
                        <Card id="add-delivery">
                          <DeliveryForm
                            // Preparation and sync never change this key. Only a
                            // confirmed save followed by Continue resets a draft.
                            key={`${trip.id}:${epoch}`}
                            simplifiedPayment
                            workspace={shown.workspace}
                            finance={shown.finance}
                            trip={trip}
                            requestKey={crypto.randomUUID()}
                            initialCustomer={
                              params.get("customer") ?? undefined
                            }
                          />
                        </Card>
                        <details className="rounded-xl border p-4">
                          <summary>
                            <T k="Collect previous credit without a new delivery" />
                          </summary>
                          {state ? (
                            <OfflineCollection
                              state={state}
                              busy={busy}
                              save={(d) =>
                                record("PAYMENT", d)
                                  .then(() => true)
                                  .catch((e) => {
                                    setMessage(storageMessage(e));
                                    return false;
                                  })
                              }
                            />
                          ) : (
                            <CollectCreditForm
                              finance={shown.finance}
                              workspace={shown.workspace}
                              trip={trip}
                              requestKey={crypto.randomUUID()}
                            />
                          )}
                        </details>
                      </>
                    ) : (
                      <p>
                        <T k="No active delivery stock. Waiting for warehouse loading." />
                      </p>
                    )}
                  </>
                )}
                {path === "/driver/customers" &&
                  (state ? (
                    <>
                      <OfflineCustomers
                        state={state}
                        busy={busy}
                        save={(d, edit) =>
                          record(edit ? "CONTACT" : "CUSTOMER", d)
                            .then(() => true)
                            .catch((e) => {
                              setMessage(storageMessage(e));
                              return false;
                            })
                        }
                      />
                      <OfflineCollection
                        state={state}
                        busy={busy}
                        save={(d) =>
                          record("PAYMENT", d)
                            .then(() => true)
                            .catch((e) => {
                              setMessage(storageMessage(e));
                              return false;
                            })
                        }
                      />
                    </>
                  ) : (
                    <DriverCustomers
                      workspace={shown.workspace}
                      trip={shown.delivering ? trip : undefined}
                    />
                  ))}
                {path === "/driver/pending-jars" && (
                  <DriverPendingJars
                    key={params.get("customer") ?? "directory"}
                    workspace={shown.workspace}
                    pending={shown.pending}
                    state={state}
                    trip={shown.delivering ? trip : undefined}
                    customer={params.get("customer") ?? undefined}
                  />
                )}
                {path === "/driver/instant-delivery" && (
                  <InstantDriver
                    key={`${trip?.id ?? "idle"}:${epoch}`}
                    data={shown}
                    state={state}
                    online={mode === "ONLINE"}
                  />
                )}
                {path === "/driver/sales" && (
                  <>
                    <DriverSalesView
                      data={shown}
                      q={{
                        from: params.get("from") ?? undefined,
                        to: params.get("to") ?? undefined,
                      }}
                    />
                    {state &&
                      state.operations.some((o) => o.status !== "SYNCED") && (
                        <OfflineHistory state={state} pendingOnly />
                      )}
                  </>
                )}
                {path === "/driver/return" && (
                  <>
                    <h1 className="text-3xl font-bold">
                      <T k="Return to Warehouse" />
                    </h1>
                    {trip &&
                      ["SUBMITTED", "UNDER_REVIEW", "DISCREPANCY"].includes(
                        trip.status,
                      ) && (
                        <p role="status">
                          <T k="Awaiting warehouse verification" />
                        </p>
                      )}
                    {trip && (
                      <DriverStock workspace={shown.workspace} trip={trip} />
                    )}{" "}
                    {state?.paused ? (
                      <p role="status">
                        <T k="This trip is paused for carryover. Resume online after admin authorization." />
                      </p>
                    ) : state ? (
                      <OfflineReturnForm
                        state={state}
                        busy={busy}
                        save={(counts) =>
                          record("SUBMIT", {
                            counts,
                            manifest: state.operations.map((o) => ({
                              id: o.id,
                              fingerprint: o.fingerprint,
                            })),
                          })
                            .then(() => true)
                            .catch((e) => {
                              setMessage(storageMessage(e));
                              return false;
                            })
                        }
                      />
                    ) : trip && shown.delivering ? (
                      <ReturnForm
                        workspace={shown.workspace}
                        trip={trip}
                        requestKey={crypto.randomUUID()}
                        admin={false}
                      />
                    ) : (
                      <p>
                        <T k="No active delivery stock. Waiting for warehouse loading." />
                      </p>
                    )}
                  </>
                )}
              </>
            ) : screen ? (
              <p>
                <Message
                  value={
                    mode === "CHECKING"
                      ? "Loading workspace…"
                      : "Connect to internet once before starting this trip."
                  }
                />
              </p>
            ) : (
              children
            )}
            {!shown && mode !== "CHECKING" && (
              <a className="inline-block underline" href="/sign-in?reauth=1">
                <T k="Sign in online" />
              </a>
            )}
          </main>
          <footer className="p-5 text-xs text-muted-foreground">
            <T k="Asia/Kathmandu · Business days close manually" />
          </footer>
        </div>
      </DriverRuntimeContext.Provider>
    </LocaleProvider>
  );
}
