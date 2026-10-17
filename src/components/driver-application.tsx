"use client";
import { useEffect, useRef, useState, useMemo, Suspense } from "react";
import { usePathname, useSearchParams, useRouter } from "next/navigation";
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
  replaceRevokedAutomaticDevice,
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
import { LocaleProvider, T, Message } from "./localization";

import type { InstantWorkspace } from "@/domain/instant";
import { projectedInstants } from "@/domain/offline/instant";
import { prepareOfflineShell } from "./offline/registration";

import { NotificationBell, LockedNotificationBell } from "./notification-bell";
import {
  DriverPageContainer,
  DriverMobileHeader,
  DriverBottomNav,
} from "./driver-mobile-layout";
import { DriverConnectivityStatus } from "./driver-connectivity-status";
import { DriverWorkspaceScreens } from "./driver-workspace-screens";
import { currentRound } from "@/domain/operations/driver-workspace";

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
  const router = useRouter();
  const [data, setData] = useState<DriverData>(),
    [state, setState] = useState<LocalState>();
  const [mode, setMode] = useState<Connectivity>("CHECKING"),
    [message, setMessage] = useState("");
  const [connectionMessage, setConnectionMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [authorizationTime, setAuthorizationTime] = useState(() => Date.now());
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
  const preparationError = useRef("");
  const [offlinePrepError, setOfflinePrepError] = useState("");
  function updateOfflinePrepState(next: OfflinePrepState) {
    offlinePrepRef.current = next;
    setOfflinePrepState(next);
  }
  const [view, setView] = useState<SyncView>({
    connection: "Online",
    status: "Checking server connectivity",
  });
  const [notice, setNotice] = useState(""),
    [epochs, setEpochs] = useState<Record<string, number>>({});
  const database = useMemo(() => offlineDB(), []);
  const vault = useRef<OfflineVault | undefined>(undefined),
    controller = useRef<SyncController | undefined>(undefined);
  const modeRef = useRef(mode),
    dataRef = useRef(data),
    generation = useRef(0),
    querying = useRef<Promise<Connectivity> | undefined>(undefined);
  const probeSequence = useRef(0);
  const probeAgain = useRef(false);
  const starting = useRef<
    | { trip: string; action: string; request: Promise<OperationState> }
    | undefined
  >(undefined);
  const saving = useRef(false);
  const completedScreens = useRef(new Set<string>());
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
  async function probeOnce(): Promise<Connectivity> {
    // Explicit sign-out stays effective until normal Supabase sign-in mounts a
    // new workspace. A delayed logout must not let a poll restore local access.
    if (signedOutRef.current) return "AUTHENTICATION";
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
        // The authoritative selection owns the session, even when a previous
        // unsealed vault still exists. Preserve its exact evidence separately.
        const writer = vault.current;
        if (
          dataRef.current?.trip?.id !== result.trip?.id &&
          (!writer || writer.id !== `${result.profile.id}:${result.trip?.id}`)
        ) {
          preparationError.current = "";
          setOfflinePrepError("");
          updateOfflinePrepState("IDLE");
        }
        if (writer) {
          const writerTrip = writer.id.slice(writer.id.indexOf(":") + 1);
          if (
            !writer.id.startsWith(result.profile.id + ":") ||
            result.trip?.id !== writerTrip
          ) {
            if (controller.current) controller.current.stopped = true;
            controller.current = undefined;
            vault.current = undefined;
            updateOfflinePrepState("IDLE");
            setState(undefined);
            setNotice("");
            completedScreens.current.clear();
            if (writer.id.startsWith(result.profile.id + ":")) {
              try {
                const observed = result.overview.trips.find(
                  (t) => t.id === writerTrip,
                );
                await writer.mutate((local) => {
                  const previous =
                    observed ??
                    local.snapshot.workspace.trips.find(
                      (t) => t.id === writerTrip,
                    )!;
                  local.retired = {
                    status: previous.status,
                    cancelled: !!previous.cancelled,
                    at: new Date().toISOString(),
                  };
                });
              } catch (error) {
                setMessage(storageMessage(error));
              }
            }
          }
        }
        if (
          current !== generation.current ||
          sequence !== probeSequence.current
        )
          return modeRef.current;
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
            await database.settings.put({
              key: `current-trip:${result.profile.id}`,
              value: result.trip?.id ?? "",
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
    return request;
  }
  async function probe(force = false): Promise<Connectivity> {
    if (querying.current) {
      probeAgain.current ||= force;
      return querying.current;
    }
    const current = generation.current;
    const request = (async () => {
      let connection: Connectivity;
      do {
        probeAgain.current = false;
        connection = await probeOnce();
      } while (
        probeAgain.current &&
        current === generation.current &&
        !signedOutRef.current
      );
      return connection;
    })();
    querying.current = request;
    try {
      return await request;
    } finally {
      if (querying.current === request) querying.current = undefined;
    }
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
    let preparingTrip: string | undefined;
    updateOfflinePrepState("PREPARING");
    preparationError.current = "";
    setOfflinePrepError("");
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
      const remembered = await database.settings.get(`current-trip:${user}`);
      const eligible = copies.filter((r) => !r.retired);
      const candidate =
        eligible.find((r) => r.trip === (d?.trip?.id ?? remembered?.value)) ??
        (remembered?.value === "" ? undefined : eligible.at(-1));
      const id =
        !localOnly && d
          ? d.trip &&
            !d.trip.cancelled &&
            ["LOADED", "ACTIVE"].includes(d.trip.status)
            ? `${user}:${d.trip.id}`
            : undefined
          : candidate?.id;
      if (!id || (localOnly && !candidate)) return;
      const tripId = id.slice(user.length + 1);
      preparingTrip = tripId;
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
        let credentials = await OfflineVault.prepare(
          database,
          user,
          tripId,
          secrets.secret,
          secrets,
          true,
        );
        const registration = await deviceRequest<{
          replace_installation?: boolean;
        }>({
          action: "automatic-register",
          trip: tripId,
          ...credentials,
        });
        if (registration.replace_installation) {
          // No current-trip journal may be overwritten. Rotation preserves the
          // old encrypted setup and all historical records/keys, durably before
          // registering a fresh writer. A lost response retries the same writer.
          secrets = await replaceRevokedAutomaticDevice(
            database,
            user,
            tripId,
            secrets.device,
          );
          credentials = await OfflineVault.prepare(
            database,
            user,
            tripId,
            secrets.secret,
            secrets,
            true,
          );
          const replacement = await deviceRequest<{
            replace_installation?: boolean;
          }>({
            action: "automatic-register",
            trip: tripId,
            ...credentials,
          });
          if (replacement.replace_installation)
            throw new SyncError(
              "DEVICE_RESET_REQUIRED",
              "Could not prepare offline access",
              403,
            );
        }
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
      // A startup unlock can finish after the online probe. It must not install
      // the previously selected writer over the newly confirmed current trip.
      const authoritative = dataRef.current;
      const savedTrip = local.snapshot.workspace.trips.find(
        (t) => t.id === local.snapshot.round.trip_id,
      )!;
      if (
        local.retired ||
        savedTrip.cancelled ||
        savedTrip.status === "CLOSED" ||
        (authoritative &&
          authoritative.trip?.id !== local.snapshot.round.trip_id)
      ) {
        if (!local.retired) {
          const oldTrip =
            authoritative?.overview.trips.find(
              (t) => t.id === local.snapshot.round.trip_id,
            ) ??
            local.snapshot.workspace.trips.find(
              (t) => t.id === local.snapshot.round.trip_id,
            )!;
          await opened.mutate((s) => {
            s.retired = {
              status: oldTrip.status,
              cancelled: !!oldTrip.cancelled,
              at: new Date().toISOString(),
            };
          });
        }
        return;
      }
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
          if (
            preparingTrip &&
            dataRef.current &&
            dataRef.current.trip?.id !== preparingTrip
          ) {
            updateOfflinePrepState("IDLE");
            return;
          }
          updateOfflinePrepState("FAILED");
          preparationError.current =
            error instanceof SyncError && error.code === "DEVICE_REVOKED"
              ? "This browser's offline access was revoked. Ask the warehouse admin to reset offline access."
              : error instanceof SyncError &&
                  error.code === "DEVICE_RESET_REQUIRED"
                ? "This trip is linked to another phone. Ask the warehouse admin to reset offline access."
                : "Could not prepare offline access";
          setOfflinePrepError(preparationError.current);
          setMessage(
            error instanceof SyncError
              ? error.code === "DEVICE_REVOKED"
                ? "This browser's offline access was revoked. Ask the warehouse admin to reset offline access."
                : error.code === "DEVICE_RESET_REQUIRED"
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
  useEffect(() => {
    mounted.current = true;
    let disposed = false;
    const refresh = async (event?: Event) => {
      setAuthorizationTime(Date.now());
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
    const tripChanged = () => {
      void probe(true).then((connection) => {
        if (!disposed && connection === "ONLINE")
          void controller.current?.run();
      });
    };
    window.addEventListener("mk-driver-trip-changed", tripChanged);
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
      window.removeEventListener("mk-driver-trip-changed", tripChanged);
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
      const currentTrip = dataRef.current?.trip;
      if (
        dataRef.current &&
        (currentTrip?.id !== writer.id.slice(writer.id.indexOf(":") + 1) ||
          currentTrip.cancelled ||
          currentTrip.status === "CLOSED")
      )
        throw new Error(
          "This trip is no longer current. Open your current trip.",
        );
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
    online: mode === "ONLINE",
    tripStatus: (id: string) => data?.overview.trips.find((t) => t.id === id),
    workspace: data?.workspace,
    offlinePrepState,
    offlinePrepError,
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
        if (["start", "continue"].includes(operation)) {
          const target = String(form.get("trip"));
          if (starting.current)
            return starting.current.trip === target &&
              starting.current.action === operation
              ? starting.current.request
              : { error: "A trip action is already in progress. Please wait." };
          const request = (async (): Promise<OperationState> => {
            if (modeRef.current !== "ONLINE" || !navigator.onLine)
              return {
                error:
                  "Connect to the internet to start this trip. After it starts, you can continue offline.",
              };
            if ((await probe(true)) !== "ONLINE")
              return {
                error:
                  "Connect to the internet to start this trip. After it starts, you can continue offline.",
              };
            const latest = dataRef.current;
            const requested = latest?.overview.trips.find(
              (t) => t.id === target,
            );
            if (requested?.cancelled)
              return {
                error: "This trip was cancelled. Open your current trip.",
              };
            if (latest?.trip?.id !== target || requested?.status === "CLOSED")
              return {
                error:
                  "This trip is no longer current. Open your current trip.",
              };
            if (!vault.current) await prepareOrOpenOfflineTrip();
            const writer = vault.current;
            if (!writer || offlinePrepRef.current !== "READY")
              return {
                error: preparationError.current || offlinePreparingMessage,
              };
            const local = await writer.read();
            if (local.retired)
              return {
                error:
                  "This trip is no longer current. Open your current trip.",
              };
            if (String(form.get("trip")) !== local.snapshot.round.trip_id)
              return { error: "Open the trip that is saved on this phone." };
            // Account authentication alone cannot authorize another phone's trip.
            // Reuse the server's existing ownership preflight before activation.
            await deviceRequest({
              action: "automatic-register",
              trip: local.snapshot.round.trip_id,
              device: local.device,
              token: local.token,
            });
            if (operation === "start" && requested?.status === "ACTIVE") {
              await refreshSnapshot();
              return { success: "Trip already started.", id: target };
            }
            const result = await driverOperationAction(null, form);
            if (!result?.success) {
              await probe(true);
              if (
                operation === "start" &&
                dataRef.current?.trip?.id === local.snapshot.round.trip_id &&
                dataRef.current.trip.status === "ACTIVE"
              ) {
                await refreshSnapshot();
                setNotice("Trip already started.");
                return {
                  success: "Trip already started.",
                  id: local.snapshot.round.trip_id,
                };
              }
              return result;
            }
            await refreshSnapshot();
            await probe(true);
            void controller.current?.run(true);
            setNotice("Trip active");
            return { ...result, success: "Trip active" };
          })();
          starting.current = { trip: target, action: operation, request };
          try {
            return await request;
          } finally {
            if (starting.current?.request === request)
              starting.current = undefined;
          }
        }
        // UI gating is also enforced here for stale/programmatic submissions.
        // Never wait for preparation inside a delivery save or touch its draft.
        if (
          ["driver-visit", "instant"].includes(operation) &&
          (offlinePrepRef.current !== "READY" || !vault.current)
        )
          return { error: offlinePreparingMessage };
        if (!vault.current) return { error: offlinePreparingMessage };
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
        if (["driver-visit", "instant"].includes(operation))
          completedScreens.current.add(
            operation === "instant"
              ? "/driver/instant-delivery"
              : "/driver/delivery",
          );
        return { success, id: String(form.get("id") || id) };
      } catch (error) {
        return { error: storageMessage(error) };
      }
    },
    refresh: async () => {
      if ((await probe()) === "ONLINE") await refreshSnapshot();
    },
    next: () => {
      if (!driverPaths.includes(path)) {
        // Detail pages are server-rendered. Reload only on the explicit
        // Continue action; the saved journal survives this refresh.
        window.location.reload();
        return;
      }
      completedScreens.current.delete(path);
      setEpochs((e) => ({ ...e, [path]: (e[path] ?? 0) + 1 }));
      setNotice("");
      void probe();
    },
  };
  const projected = state ? projectedWorkspace(state) : undefined;
  const useLocal =
    !!state &&
    !state.retired &&
    (data
      ? data.trip?.id === state.snapshot.round.trip_id
      : currentRound(state.snapshot.workspace)?.id ===
        state.snapshot.round.trip_id);
  const shown =
    !deviceChecked || signedOut
      ? undefined
      : data && !useLocal
        ? data
        : state && useLocal
          ? ({
              ...data,
              profile: state.snapshot.profile,
              locale: state.locale,
              round: state.snapshot.round,
              overview: data?.overview ?? projected!,
              workspace: projected!,
              finance: state.snapshot.finance,
              trip:
                data?.trip ??
                projected!.trips.find(
                  (t) => t.id === state.snapshot.round.trip_id,
                ),
              day:
                data?.day ?? projected!.days.find((d) => d.status === "OPEN"),
              dayOpen:
                data?.dayOpen ??
                projected!.days.some((d) => d.status === "OPEN"),
              delivering:
                !state.sealed &&
                !state.paused &&
                (data
                  ? data.delivering
                  : state.snapshot.round.phase === "ACTIVE"),
              history:
                data?.history ?? data?.overview.trips ?? projected!.trips,
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
  const detailId = /^\/driver\/trips\/([a-f0-9-]{36})$/i.exec(path)?.[1];
  const invoiceDetail = /^\/driver\/invoices\/[a-f0-9-]{36}$/i.test(path);
  const detailVersion = data?.overview.trips.find((t) => t.id === detailId);
  const detailSignature = detailVersion
    ? JSON.stringify([
        detailVersion.status,
        detailVersion.cancelled,
        detailVersion.scheduled_date,
        detailVersion.loaded_at,
      ])
    : "";
  const detailRead = useRef({ id: "", signature: "" });
  useEffect(() => {
    if (
      detailId &&
      detailRead.current.id === detailId &&
      detailRead.current.signature !== detailSignature
    )
      router.refresh();
    detailRead.current = { id: detailId ?? "", signature: detailSignature };
  }, [detailId, detailSignature, router]);
  const pending =
    rows
      .filter(
        (r) =>
          r.id !==
          (state ? `${state.user}:${state.snapshot.round.trip_id}` : ""),
      )
      .reduce((n, r) => n + r.pending, 0) +
    (state ? state.operations.filter((o) => o.status !== "SYNCED").length : 0);
  return (
    <LocaleProvider
      initialLocale={state?.locale ?? data?.locale ?? initialLocale}
      userId={profile?.id}
    >
      <DriverRuntimeContext.Provider
        value={screen || detailId || invoiceDetail ? runtime : null}
      >
        <DriverPageContainer
          onClickCapture={(event) => {
            const link = (event.target as HTMLElement).closest("a");
            if (
              !link ||
              event.ctrlKey ||
              event.metaKey ||
              event.shiftKey ||
              event.altKey ||
              link.target ||
              link.hasAttribute("download")
            )
              return;
            const target = new URL(link.href, window.location.href);
            if (
              target.origin === window.location.origin &&
              driverPaths.includes(target.pathname)
            ) {
              event.preventDefault();
              if (completedScreens.current.delete(target.pathname)) {
                const destination = target.pathname;
                setEpochs((e) => ({
                  ...e,
                  [destination]: (e[destination] ?? 0) + 1,
                }));
              }
              if (document.activeElement instanceof HTMLElement)
                document.activeElement.blur();
              window.history.pushState(
                null,
                "",
                target.pathname + target.search,
              );
              window.scrollTo({ top: 0, behavior: "auto" });
            }
          }}
        >
          <DriverMobileHeader
            name={profile?.name}
            online={mode !== "OFFLINE"}
            notifications={
              profile ? (
                <NotificationBell
                  key={profile.id}
                  profile={profile}
                  onTripChange={() =>
                    window.dispatchEvent(new Event("mk-driver-trip-changed"))
                  }
                  online={mode === "ONLINE"}
                  unlocked={
                    deviceChecked &&
                    !signedOut &&
                    mode !== "AUTHORIZATION" &&
                    (mode === "ONLINE" ||
                      !state ||
                      authorizationTime <
                        Date.parse(state.snapshot.authorizedUntil))
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
              )
            }
          />
          <DriverBottomNav path={path} />
          <main
            id="main-content"
            className="driver-main mx-auto w-full max-w-6xl space-y-4 px-4 pt-4 sm:px-6 sm:pt-6"
          >
            <DriverConnectivityStatus
              mode={mode}
              prep={offlinePrepState}
              pending={pending}
              status={view.status}
              retry={() => void prepareOrOpenOfflineTrip()}
            />
            {message && (
              <p
                role="alert"
                className="rounded-lg bg-red-50 p-3 text-sm text-red-800"
              >
                <Message value={message} />
              </p>
            )}
            {connectionMessage &&
              ["AUTHENTICATION", "AUTHORIZATION", "DATABASE"].includes(
                mode,
              ) && (
                <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm">
                  <Message value={connectionMessage} />
                </p>
              )}
            {state?.paused && (
              <p role="status" className="text-sm">
                <T k="This trip is paused. Reopen online after the warehouse approves tomorrow's trip." />
              </p>
            )}
            {notice && (
              <p
                role="status"
                className="rounded-lg bg-teal-50 px-3 py-2 text-sm text-teal-900"
              >
                <Message value={notice} />
              </p>
            )}
            {shown && screen ? (
              <DriverWorkspaceScreens
                key={shown.trip?.id ?? "waiting"}
                path={path}
                params={params}
                data={shown}
                state={useLocal ? state : undefined}
                busy={busy}
                epochs={epochs}
                online={mode === "ONLINE"}
                record={(kind, value) =>
                  record(kind, value)
                    .then(() => true)
                    .catch((error) => {
                      setMessage(storageMessage(error));
                      return false;
                    })
                }
              />
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
              <a
                className="inline-flex min-h-11 items-center text-primary underline"
                href="/sign-in?reauth=1"
              >
                <T k="Sign in online" />
              </a>
            )}
          </main>
        </DriverPageContainer>
      </DriverRuntimeContext.Provider>
    </LocaleProvider>
  );
}
