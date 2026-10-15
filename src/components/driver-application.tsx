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
import { offlineDB, OfflineVault, storageMessage } from "@/lib/offline/store";
import {
  trustedDevice,
  saveTrustedDevice,
  unlockDevice,
  unlockBiometric,
  enableBiometric,
  biometricsAvailable,
  requireDeviceSignIn,
  lockDriverApp,
  deviceTabId,
  type TrustedDevice,
  type DeviceSecrets,
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
import { DriverRuntimeContext, driverPaths } from "./driver-runtime-context";
import { LocaleProvider, LanguageSwitcher, T, Message } from "./localization";
import { Navigation } from "./navigation";
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
import { Button } from "./ui/button";
import { Input } from "./ui/input";
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
function validateOfflinePin(pin: string) {
  if (!/^\d{4}$/.test(pin)) {
    throw new Error("Choose a 4-digit PIN.");
  }

  if (/^(\d)\1{3}$/.test(pin)) {
    throw new Error("Avoid repeated digits in your PIN.");
  }

  const ascending = "0123456789";
  const descending = "9876543210";
  if (ascending.includes(pin) || descending.includes(pin)) {
    throw new Error("Avoid consecutive digits in your PIN.");
  }
}

function validateOfflinePassphrase(passphrase: string) {
  if (passphrase.length < 6) {
    throw new Error("Offline passphrase must be at least 6 characters.");
  }
}

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
  const [pass, setPass] = useState(""),
    [unlock, setUnlock] = useState(false),
    [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<
    { id: string; trip: string; pending: number; review: number }[]
  >([]);
  const [preparations, setPreparations] = useState<string[]>([]);
  const [trusted, setTrusted] = useState<TrustedDevice>();
  const [deviceChecked, setDeviceChecked] = useState(false);
  const [locked, setLocked] = useState(false);
  const lockedRef = useRef(false);
  const secretsRef = useRef<DeviceSecrets | undefined>(undefined);
  const legacySecret = useRef("");
  const [configurePin, setConfigurePin] = useState(false);
  const [pin, setPin] = useState(""),
    [confirmPin, setConfirmPin] = useState("");
  const [recovery, setRecovery] = useState(false),
    [password, setPassword] = useState("");
  const [biometric, setBiometric] = useState(false);
  const [selectedVault, setSelectedVault] = useState("");
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
      const device = await trustedDevice(database, user);
      const values = await database.vaults
        .where("user")
        .equals(user)
        .sortBy("updated");
      const prepared = await database.preparations
        .where("user")
        .equals(user)
        .primaryKeys();
      if (current === generation.current) {
        setTrusted(device);
        lockedRef.current = !!device && !secretsRef.current;
        setLocked(lockedRef.current);
        setDeviceChecked(true);
        setRows(values);
        setPreparations(prepared);
      }
    } catch (error) {
      if (current === generation.current) setMessage(storageMessage(error));
    }
  }
  async function probe(force = false): Promise<Connectivity> {
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
            secretsRef.current = undefined;
            legacySecret.current = "";
            setTrusted(undefined);
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
              setState(undefined);
              setSelectedVault("");
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
          await requireDeviceSignIn(database, result.profile.id, false);
          await database.settings.put({
            key: "active-user",
            value: result.profile.id,
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
      const connection = await probe(
        event?.type === "online" || event?.type === "offline",
      );
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
    const lock = (event: Event | MessageEvent) => {
      if ((event as MessageEvent).data?.source === deviceTabId()) return;
      const app =
        (event as CustomEvent).detail?.app || (event as MessageEvent).data?.app;
      generation.current++;
      if (controller.current) controller.current.stopped = true;
      controller.current = undefined;
      vault.current = undefined;
      secretsRef.current = undefined;
      legacySecret.current = "";
      lockedRef.current = true;
      setLocked(true);
      setState(undefined);
      setData(undefined);
      dataRef.current = undefined;
      setPass("");
      setPin("");
      setConfirmPin("");
      setPassword("");
      setRows([]);
      setPreparations([]);
      setSelectedVault("");
      selectedLocale.current = false;
      if (!app) {
        setMode("AUTHENTICATION");
        modeRef.current = "AUTHENTICATION";
        setMessage("Sign in online again. Device records are preserved.");
      } else setMessage("");
      setUnlock(true);
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
    void biometricsAvailable().then(setBiometric);
    void database
      .open()
      .catch((error) => {
        if (!disposed) setMessage(storageMessage(error));
      })
      .then(() => {
        if (!disposed) {
          void loadRows();
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
          "Offline reopening could not be prepared. Saved device records are preserved. Reconnect and unlock again before working offline.",
        );
    });
  }, [mode, rows.length]);
  useEffect(() => {
    // An already unlocked, approved phone reuses its device key for the next
    // confirmed active round. Never replace a round with pending evidence.
    if (
      mode === "ONLINE" &&
      trusted &&
      secretsRef.current &&
      (data?.delivering || data?.trip?.status === "LOADED") &&
      data.trip &&
      !vault.current &&
      !busy
    )
      void open();
    // Refreshes of the same trip must not start concurrent activation requests.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    mode,
    data?.trip?.id,
    data?.trip?.status,
    data?.delivering,
    trusted?.device,
  ]);
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
    const response = await fetch("/api/driver/device", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const value = await response.json();
    if (!response.ok)
      throw new SyncError(value.code, value.message, response.status);
    return value;
  }
  async function open(useBiometric = false) {
    setBusy(true);
    setMessage("");
    const current = generation.current;
    try {
      const d = dataRef.current;
      const id =
        selectedVault ||
        (d?.trip ? `${d.profile.id}:${d.trip.id}` : rows[rows.length - 1]?.id);
      if (!id)
        throw new Error(
          "Start a confirmed loaded trip online before preparing this device.",
        );
      let opened: OfflineVault;
      let created = false;
      let secret = pass;
      let credentials: { device: string; token: string } | undefined;
      let deviceSecrets = secretsRef.current;
      if (trusted && !deviceSecrets) {
        deviceSecrets = useBiometric
          ? await unlockBiometric(database, trusted.user)
          : await unlockDevice(database, trusted.user, pin);
      }
      if (deviceSecrets) {
        secret = pass || deviceSecrets.secret;
        credentials = deviceSecrets;
      }
      const setupPin = !trusted && !!pin;
      if (!setupPin && !existingVault) {
        validateOfflinePassphrase(pass);
      }
      if (setupPin) {
        validateOfflinePin(pin);
        if (pin !== confirmPin) throw new Error("PINs do not match.");
        if (await database.vaults.get(id))
          throw new Error(
            "Unlock the existing passphrase records before changing device setup.",
          );
        secret = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
          b.toString(16).padStart(2, "0"),
        ).join("");
      }
      if (await database.vaults.get(id))
        opened = await OfflineVault.unlock(database, id, secret);
      else {
        if (
          modeRef.current !== "ONLINE" ||
          !d?.trip ||
          (!d.delivering && d.trip.status !== "LOADED")
        )
          throw new Error(
            "Start a confirmed loaded trip online before preparing this device.",
          );
        credentials = await OfflineVault.prepare(
          database,
          d.profile.id,
          d.trip.id,
          secret,
          credentials,
        );
        if (setupPin) {
          deviceSecrets = { ...credentials, secret };
          // Persist the encrypted activation credentials before a request whose
          // response may be lost. Offline access still requires a server grant.
          await saveTrustedDevice(database, d.profile.id, pin, deviceSecrets);
        }
        if (deviceSecrets)
          await deviceRequest({
            action: "register",
            device: credentials.device,
            secrets: deviceSecrets,
          });
        await prepareOfflineShell();
        shellPrepared.current = true;
        const snapshot = await offlineRequest<OfflineSnapshot>({
          action: "register",
          trip: d.trip.id,
          ...credentials,
        });
        // The driver may have changed the display language since the last
        // confirmed snapshot. Keep that preference in the new encrypted vault.
        snapshot.locale = localeRef.current;
        opened = await OfflineVault.create(
          database,
          snapshot,
          credentials.device,
          credentials.token,
          secret,
        );
        created = true;
        if (!(await navigator.storage?.persist?.()))
          setNotice(
            "Persistent storage was not granted. Sync regularly and keep an encrypted backup. Browser data removal can erase device records.",
          );
      }
      const local = selectedLocale.current
        ? await opened.mutate((s) => {
            s.locale = localeRef.current;
          })
        : await opened.read();
      if (current !== generation.current) return;
      if (d && local.user !== d.profile.id)
        throw new Error(
          "Sign in as the owner of these device records before synchronization.",
        );
      vault.current = opened;
      secretsRef.current = deviceSecrets;
      legacySecret.current = deviceSecrets ? "" : secret;
      lockedRef.current = false;
      setLocked(false);
      setState(local);
      window.dispatchEvent(
        new CustomEvent("mk-locale-restored", { detail: local.locale }),
      );
      setPass("");
      setPin("");
      setConfirmPin("");
      setUnlock(false);
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
      if (modeRef.current === "ONLINE") {
        void prepareOfflineShell().catch(() =>
          setNotice(
            "Offline reopening could not be prepared. Saved device records are preserved. Reconnect and unlock again before working offline.",
          ),
        );
        if (created) {
          // Registration already returned an authenticated, confirmed snapshot
          // and its empty journal is durable. There is no operation to upload.
          // The status renderer still checks pending records in every round.
          setView({ connection: "Online", status: "All Synced" });
        } else {
          await controller.current.run();
          await probe(true);
        }
      }
    } catch (error) {
      setMessage(storageMessage(error));
      await loadRows();
    } finally {
      setBusy(false);
    }
  }
  async function record(
    kind: Parameters<OfflineVault["record"]>[0],
    draft: unknown,
    id = crypto.randomUUID(),
  ) {
    if (saving.current) throw new Error("Saving…");
    saving.current = true;
    setBusy(true);
    const writer = vault.current,
      current = generation.current,
      synchronizer = controller.current;
    try {
      if (!writer) {
        setUnlock(true);
        throw new Error(
          "Unlock device records before saving. Your draft is preserved.",
        );
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
      if (current === generation.current && modeRef.current === "ONLINE") {
        // A background run may already own the lease. Wait for it, then flush this
        // exact outbox operation; never issue an independent second sale.
        const deadline = Date.now() + 45000;
        while (
          synchronizer?.running &&
          !synchronizer.stopped &&
          Date.now() < deadline
        )
          await new Promise((resolve) => setTimeout(resolve, 100));
        if (current === generation.current) await synchronizer?.run(true);
        local = await writer.read();
        if (current === generation.current && vault.current === writer)
          setState(local);
        if (local.operations.find((o) => o.id === id)?.status === "SYNCED") {
          if (current === generation.current) setNotice("Saved to Supabase.");
          return "Saved to Supabase.";
        }
        if (current === generation.current) await probe();
      }
      const saved = local.operations.find((o) => o.id === id)!;
      const result =
        saved.status === "NEEDS_REVIEW"
          ? "Saved on Device. Admin review required."
          : "Saved on Device";
      if (current === generation.current) setNotice(result);
      return result;
    } finally {
      saving.current = false;
      if (current === generation.current) setBusy(false);
    }
  }
  const runtime = {
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
      if (modeRef.current === "OFFLINE") {
        if (!vault.current) {
          setUnlock(true);
          throw new Error(
            "Unlock device records before saving. Your draft is preserved.",
          );
        }
        return projectedCustomer(await vault.current.read(), id);
      }
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
        if (lockedRef.current)
          throw new Error(
            "Unlock device records before saving. Your draft is preserved.",
          );
        const operation = String(form.get("operation")),
          id = String(form.get("key"));
        if (!vault.current) {
          if (dataRef.current?.round || modeRef.current !== "ONLINE") {
            setUnlock(true);
            throw new Error(
              "Unlock device records before saving. Your draft is preserved.",
            );
          }
          let result: OperationState;
          try {
            result = await driverOperationAction(null, form);
          } catch (error) {
            if ((await probe(true)) === "OFFLINE")
              throw new Error(
                "Unlock device records to use your confirmed offline stock.",
              );
            throw error;
          }
          if (
            result?.error ===
            "Use the registered offline device for this delivery round."
          ) {
            await probe(true);
            setUnlock(true);
            return {
              error:
                "Unlock device records before saving. Your draft is preserved.",
            };
          }
          if (result?.error && (await probe(true)) === "OFFLINE") {
            setUnlock(true);
            return {
              error:
                "Unlock device records to use your confirmed offline stock.",
            };
          }
          if (result?.success) {
            if (operation === "start" || operation === "submit")
              setNotice("Saved to Supabase.");
            // A request begun before this write can contain stale inventory or
            // ACTIVE status. Fetch a newer version before presenting success.
            await probe(true);
            return { ...result, success: "Saved to Supabase." };
          }
          return result;
        }
        const local = await vault.current.read();
        if (String(form.get("trip")) !== local.snapshot.round.trip_id)
          throw new Error(
            "Unlock the device records for the selected delivery round.",
          );
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
              notes: String(form.get("notes") ?? ""),
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
        } else {
          if (modeRef.current !== "ONLINE")
            throw new Error(
              "This action requires server confirmation. Your saved records remain on this device.",
            );
          const result = await driverOperationAction(null, form);
          if (result?.success) {
            if (["start", "continue"].includes(operation))
              setNotice("Saved to Supabase.");
            await controller.current?.run(true);
            await probe(true);
          }
          return result?.success
            ? { ...result, success: "Saved to Supabase." }
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
    !deviceChecked || locked
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
  const selectedId =
    selectedVault ||
    (data?.trip
      ? `${data.profile.id}:${data.trip.id}`
      : rows[rows.length - 1]?.id);
  const existingVault = rows.some((r) => r.id === selectedId);
  const otherDevice =
    !!data?.round && !existingVault && !preparations.includes(selectedId ?? "");
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
                    !locked &&
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
                          if (!active || locked) return;
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
              {state && !trusted && mode === "ONLINE" && (
                <Button variant="outline" onClick={() => setConfigurePin(true)}>
                  <T k="Set unlock PIN" />
                </Button>
              )}
              {trusted && !locked && (
                <Button variant="outline" onClick={() => void lockDriverApp()}>
                  <T k="Lock App" />
                </Button>
              )}
              {profile && <SignOutButton user={profile.id} driver />}
              {trusted && (
                <details className="relative">
                  <summary className="cursor-pointer">
                    <T k="Device access" />
                  </summary>
                  <div className="space-y-3 rounded-lg border bg-card p-3">
                    <Button variant="outline" onClick={() => setRecovery(true)}>
                      <T k="Recover PIN online" />
                    </Button>
                    {biometric && !locked && (
                      <Button
                        variant="outline"
                        onClick={() => {
                          void enableBiometric(
                            database,
                            trusted.user,
                            secretsRef.current!,
                          )
                            .then(loadRows)
                            .catch((e) => setMessage(storageMessage(e)));
                        }}
                      >
                        <T k="Enable device biometric unlock" />
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      disabled={
                        busy ||
                        pending > 0 ||
                        !state?.sealed ||
                        mode !== "ONLINE"
                      }
                      onClick={() => {
                        void (async () => {
                          try {
                            if (
                              (
                                await database.vaults
                                  .where("user")
                                  .equals(trusted.user)
                                  .toArray()
                              ).some((r) => r.pending)
                            )
                              throw new Error(
                                "Sync all pending records before removing this device.",
                              );
                            await deviceRequest({
                              action: "remove",
                              device: trusted.device,
                            });
                            await requireDeviceSignIn(
                              database,
                              trusted.user,
                              true,
                            );
                            await lockDriverApp();
                            setMessage(
                              "Device access removed. Encrypted records are preserved.",
                            );
                          } catch (e) {
                            setMessage(storageMessage(e));
                          }
                        })();
                      }}
                    >
                      <T k="Remove Device" />
                    </Button>
                  </div>
                </details>
              )}
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
              {trusted &&
                state &&
                Date.now() < Date.parse(state.snapshot.authorizedUntil) && (
                  <p>
                    <T k="Device Ready" />
                  </p>
                )}
              <p>
                <Message
                  value={
                    mode === "ONLINE"
                      ? "Online"
                      : mode === "OFFLINE"
                        ? "Offline"
                        : mode === "CHECKING"
                          ? "Checking server connectivity"
                          : mode === "SERVER_UNAVAILABLE"
                            ? "Server unavailable. Device records are preserved."
                            : mode === "AUTHENTICATION"
                              ? "Sign in online again. Device records are preserved."
                              : mode === "AUTHORIZATION"
                                ? "Driver authorization is unavailable. Saved records need review."
                                : "Database update required. Contact the admin."
                  }
                />
              </p>
              <p data-testid="pending-sync-count">
                <T k="Pending records: {0}" values={[pending]} />
              </p>
              <p role="status">
                <Message
                  value={
                    state &&
                    !pending &&
                    view.status === "All Synced" &&
                    mode === "ONLINE"
                      ? "All Synced"
                      : state
                        ? view.status === "All Synced"
                          ? "Waiting to Sync"
                          : view.status
                        : pending
                          ? "Unlock device records to synchronize pending transactions."
                          : "Device records are locked"
                  }
                />
              </p>
              {view.message && (
                <p>
                  <Message value={view.message} />
                </p>
              )}
              <Button
                variant="outline"
                disabled={!!state}
                onClick={() => setUnlock((v) => !v)}
              >
                <Message
                  value={
                    state
                      ? "Device records unlocked"
                      : existingVault || pending
                        ? "Device access"
                        : "Set up offline access"
                  }
                />
              </Button>
              {state && (
                <Button
                  variant="outline"
                  onClick={() => {
                    void probe().then((m) => {
                      if (m === "ONLINE") void controller.current?.run(true);
                    });
                  }}
                >
                  <T k="Retry synchronization" />
                </Button>
              )}
            </Card>
            {(unlock ||
              (locked && !!trusted) ||
              (!shown && mode !== "CHECKING" && rows.length > 0)) && (
              <Card className="space-y-4" id="device-unlock">
                <p>
                  <Message
                    value={
                      trusted
                        ? "Unlock App"
                        : existingVault
                          ? "Unlock your device records using your offline passphrase. Supabase passwords are never stored here."
                          : "Set a PIN for this approved phone, or keep using an offline passphrase."
                    }
                  />
                </p>
                {rows.some((r) => r.id !== selectedId) && (
                  <label className="grid gap-2">
                    <T k="Delivery round" />
                    <select
                      value={selectedId}
                      onChange={(e) => setSelectedVault(e.target.value)}
                    >
                      {rows.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.trip} · {r.pending}
                        </option>
                      ))}
                      {data?.trip &&
                        !rows.some((r) => r.trip === data.trip!.id) && (
                          <option value={`${data.profile.id}:${data.trip.id}`}>
                            {data.trip.id}
                          </option>
                        )}
                    </select>
                  </label>
                )}
                {otherDevice && (
                  <p role="alert">
                    <T k="Unlock this round on the browser and device where it was prepared. Contact the warehouse admin if those records are unavailable." />
                  </p>
                )}
                {!trusted && !existingVault && (
                  <>
                    <label className="grid gap-2">
                      <T k="Enter PIN" />
                      <Input
                        type="password"
                        inputMode="numeric"
                        autoComplete="new-password"
                        value={pin}
                        maxLength={4}
                        onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
                      />
                    </label>
                    <label className="grid gap-2">
                      <T k="Confirm PIN" />
                      <Input
                        type="password"
                        inputMode="numeric"
                        autoComplete="new-password"
                        value={confirmPin}
                        maxLength={4}
                        onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
                      />
                    </label>
                    <p>
                      <T k="Choose a 4-digit PIN; avoid repeated or consecutive digits." />
                    </p>
                  </>
                )}
                {trusted ? (
                  <label className="grid gap-2">
                    <T k="Enter PIN" />
                    <Input
                      type="password"
                      inputMode="numeric"
                      autoComplete="off"
                      value={pin}
                      maxLength={4}
                      onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
                    />
                  </label>
                ) : (
                  <label className="grid gap-2">
                    <T k="Offline passphrase" />
                    <Input
                      type="password"
                      autoComplete="off"
                      value={pass}
                      onChange={(e) => setPass(e.target.value)}
                      minLength={6}
                    />
                  </label>
                )}
                {trusted?.biometric && (
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => void open(true)}
                  >
                    <T k="Unlock with device biometrics" />
                  </Button>
                )}
                {trusted && existingVault && (
                  <details>
                    <summary className="cursor-pointer">
                      <T k="Older passphrase records" />
                    </summary>
                    <p>
                      <T k="Use the original passphrase for an older delivery round. Its saved records are preserved." />
                    </p>
                    <label className="grid gap-2">
                      <T k="Offline passphrase" />
                      <Input
                        type="password"
                        autoComplete="off"
                        value={pass}
                        onChange={(e) => setPass(e.target.value)}
                      />
                    </label>
                  </details>
                )}
                <Button
                  disabled={
                    busy ||
                    mode === "CHECKING" ||
                    otherDevice ||
                    (!existingVault &&
                      ((!data?.delivering && data?.trip?.status !== "LOADED") ||
                        mode !== "ONLINE"))
                  }
                  onClick={() => void open()}
                >
                  <Message
                    value={
                      busy
                        ? "Saving…"
                        : trusted && existingVault
                          ? "Unlock App"
                          : existingVault
                            ? "Unlock device records"
                            : "Prepare this device online"
                    }
                  />
                </Button>
              </Card>
            )}
            {trusted && recovery && (
              <Card className="space-y-3">
                <h2>
                  <T k="Recover PIN online" />
                </h2>
                <p>
                  <T k="Reauthenticate online to reset your PIN. Saved transactions are preserved." />
                </p>
                <a className="underline" href="/sign-in?reauth=1">
                  <T k="Sign in online" />
                </a>
                <label className="grid gap-2">
                  <T k="Password" />
                  <Input
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </label>
                <label className="grid gap-2">
                  <T k="New PIN" />
                  <Input
                    type="password"
                    inputMode="numeric"
                    autoComplete="new-password"
                    value={pin}
                    maxLength={4}
                    onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
                  />
                </label>
                <label className="grid gap-2">
                  <T k="Confirm PIN" />
                  <Input
                    type="password"
                    inputMode="numeric"
                    autoComplete="new-password"
                    value={confirmPin}
                    maxLength={4}
                    onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
                  />
                </label>
                <Button
                  disabled={busy || mode !== "ONLINE"}
                  onClick={() => {
                    void (async () => {
                      setBusy(true);
                      setMessage("");
                      try {
                        validateOfflinePin(pin);
                        if (pin !== confirmPin)
                          throw new Error("PINs do not match.");
                        const secrets = await deviceRequest<DeviceSecrets>({
                          action: "recover",
                          device: trusted.device,
                          password,
                        });
                        await saveTrustedDevice(
                          database,
                          trusted.user,
                          pin,
                          secrets,
                        );
                        setPassword("");
                        setPin("");
                        setConfirmPin("");
                        setRecovery(false);
                        await loadRows();
                        setNotice(
                          "PIN updated. Your saved records are preserved.",
                        );
                      } catch (e) {
                        setMessage(storageMessage(e));
                      } finally {
                        setBusy(false);
                      }
                    })();
                  }}
                >
                  <T k="Reset PIN" />
                </Button>
              </Card>
            )}
            {state && !trusted && configurePin && (
              <Card className="space-y-3">
                <h2>
                  <T k="Set unlock PIN" />
                </h2>
                <label className="grid gap-2">
                  <T k="Enter PIN" />
                  <Input
                    type="password"
                    inputMode="numeric"
                    autoComplete="new-password"
                    value={pin}
                    maxLength={4}
                    onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
                  />
                </label>
                <label className="grid gap-2">
                  <T k="Confirm PIN" />
                  <Input
                    type="password"
                    inputMode="numeric"
                    autoComplete="new-password"
                    value={confirmPin}
                    maxLength={4}
                    onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
                  />
                </label>
                <Button
                  disabled={busy || mode !== "ONLINE"}
                  onClick={() => {
                    void (async () => {
                      setBusy(true);
                      setMessage("");
                      try {
                        validateOfflinePin(pin);
                        if (pin !== confirmPin)
                          throw new Error("PINs do not match.");
                        const secrets = {
                          secret: legacySecret.current,
                          device: state.device,
                          token: state.token,
                        };
                        await deviceRequest({
                          action: "register",
                          device: state.device,
                          secrets,
                        });
                        await saveTrustedDevice(
                          database,
                          state.user,
                          pin,
                          secrets,
                        );
                        secretsRef.current = secrets;
                        setPin("");
                        setConfirmPin("");
                        setConfigurePin(false);
                        await loadRows();
                        setNotice(
                          "PIN updated. Your saved records are preserved.",
                        );
                      } catch (e) {
                        setMessage(storageMessage(e));
                      } finally {
                        setBusy(false);
                      }
                    })();
                  }}
                >
                  <T k="Save PIN" />
                </Button>
              </Card>
            )}
            {message && (
              <p role="alert" className="rounded-lg bg-red-50 p-4 text-red-800">
                <Message value={message} />
              </p>
            )}
            {connectionMessage && (
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
                      : rows.length
                        ? "Unlock device records to use your confirmed offline stock."
                        : "Activate this device online before using offline access."
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
            {state && (
              <Button
                variant="outline"
                onClick={() => {
                  void vault.current!.exportBackup().then((value) => {
                    const url = URL.createObjectURL(
                      new Blob([value], { type: "application/json" }),
                    );
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `kailash-encrypted-${state.snapshot.round.trip_id}.json`;
                    a.click();
                    URL.revokeObjectURL(url);
                  });
                }}
              >
                <T k="Export encrypted backup" />
              </Button>
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
