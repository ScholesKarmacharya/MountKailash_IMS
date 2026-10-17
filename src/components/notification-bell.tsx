"use client";
import { useEffect, useId, useRef, useState } from "react";
import {
  Bell,
  CheckCheck,
  Truck,
  PackageCheck,
  Warehouse,
  AlertTriangle,
  CircleX,
  X,
} from "lucide-react";
import type { Profile } from "@/domain/auth/roles";
import {
  applyPendingReads,
  mergeNotifications,
  notificationCopy,
  notificationHref,
  type Notification,
  type NotificationCache,
  type NotificationFeed,
} from "@/domain/notifications";
import { browserClient } from "@/lib/supabase/browser";
import { subscribeNotifications } from "@/lib/notifications/realtime";
import { useLocale, T, DateValue, Message, Value } from "./localization";
import { Button } from "./ui/button";

type Props = {
  profile: Profile;
  online?: boolean;
  unlocked?: boolean;
  cache?: NotificationCache;
  persist?: (cache: NotificationCache) => Promise<void>;
  onTripChange?: () => void;
};
export function LockedNotificationBell() {
  const { t } = useLocale();
  return (
    <Button
      variant="ghost"
      disabled
      className="size-11 p-0"
      aria-label={t("Notifications")}
      title={t("Unlock the app to view cached notifications.")}
      data-testid="notification-bell"
    >
      <Bell className="size-5" aria-hidden="true" />
    </Button>
  );
}
const empty = (): NotificationCache => ({
  items: [],
  unread: 0,
  fetched_at: new Date().toISOString(),
  pending_read: [],
});
function NotificationIcon({
  type,
  className,
}: {
  type: Notification["type"];
  className: string;
}) {
  const props = { className, "aria-hidden": true as const };
  if (type === "TRIP_CANCELLED") return <CircleX {...props} />;
  if (type.includes("REVIEW") || type === "STOCK_DISCREPANCY")
    return <AlertTriangle {...props} />;
  if (type === "STOCK_LOADED") return <PackageCheck {...props} />;
  if (type.startsWith("RETURN")) return <Warehouse {...props} />;
  return <Truck {...props} />;
}
async function request<T>(before?: number, signal?: AbortSignal): Promise<T> {
  const response = await fetch(
    `/api/notifications${before ? `?before=${before}` : ""}`,
    {
      credentials: "same-origin",
      cache: "no-store",
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(12000)])
        : AbortSignal.timeout(12000),
    },
  );
  if (!response.ok) throw new Error(String(response.status));
  return response.json();
}
async function acknowledge(ids: string[], through?: number) {
  const response = await fetch("/api/notifications", {
    method: "POST",
    keepalive: true,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids, all: through !== undefined, through }),
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error(String(response.status));
}

export function NotificationBell({
  profile,
  online: applicationOnline = true,
  unlocked = true,
  cache,
  persist,
  onTripChange,
}: Props) {
  const { t, number } = useLocale();
  const [network, setNetwork] = useState(true);
  const online = applicationOnline && network;
  const panelId = useId();
  const [feed, setFeed] = useState<NotificationCache>(cache ?? empty);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [connected, setConnected] = useState(false);
  const [toast, setToast] = useState<{ item: Notification; more: number }>();
  const [paused, setPaused] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const root = useRef<HTMLDivElement>(null),
    bell = useRef<HTMLButtonElement>(null),
    panel = useRef<HTMLDivElement>(null);
  const current = useRef(feed),
    persistence = useRef(persist);
  const tripChanged = useRef(onTripChange);
  const known = useRef(new Set(cache?.items.map((n) => n.id)));
  const initialized = useRef(!!cache?.items.length),
    cacheLoaded = useRef(!!cache);
  const busy = useRef(false),
    mounted = useRef(true),
    refresh = useRef<() => Promise<void>>(async () => {});
  const runId = useRef(0);
  const marking = useRef(false);
  useEffect(() => {
    persistence.current = persist;
    tripChanged.current = onTripChange;
  }, [persist, onTripChange]);
  const seenKey = `mk-notification-seen:${profile.id}`;
  useEffect(() => {
    const update = () => setNetwork(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  async function save(value: NotificationCache) {
    if (persistence.current) {
      try {
        await persistence.current({
          ...value,
          items: value.items.slice(0, 500),
        });
      } catch {
        if (mounted.current)
          setError("Notification history could not be saved on this device.");
        return false;
      }
    }
    current.current = value;
    if (mounted.current) setFeed(value);
    return true;
  }
  function remember(items: Notification[]) {
    items.forEach((item) => known.current.add(item.id));
    // IDs only; customer/driver names and payloads never enter web storage.
    try {
      sessionStorage.setItem(
        seenKey,
        JSON.stringify([...known.current].slice(-5000)),
      );
    } catch {
      /* memory dedup remains */
    }
  }
  useEffect(() => {
    mounted.current = true;
    try {
      const ids = JSON.parse(sessionStorage.getItem(seenKey) ?? "[]");
      if (Array.isArray(ids))
        ids
          .filter((id) => typeof id === "string")
          .forEach((id) => known.current.add(id));
      if (known.current.size) initialized.current = true;
    } catch {
      /* a corrupt seen list cannot block the inbox */
    }
    return () => {
      mounted.current = false;
    };
  }, [seenKey]);
  useEffect(() => {
    if (
      cache &&
      unlocked &&
      (!cacheLoaded.current || cache.fetched_at > current.current.fetched_at) &&
      !busy.current
    ) {
      cacheLoaded.current = true;
      current.current = cache;
      setFeed(cache);
      cache.items.forEach((item) => known.current.add(item.id));
      if (cache.items.length) initialized.current = true;
    }
  }, [cache, unlocked]);

  useEffect(() => {
    if (!unlocked || !online) {
      queueMicrotask(() => {
        setConnected(false);
        setToast(undefined);
        setLoading(false);
      });
      return;
    }
    let stopped = false;
    const abort = new AbortController();
    const sync = async () => {
      if (stopped || busy.current || navigator.onLine === false) return;
      busy.current = true;
      const run = ++runId.current;
      setLoading(true);
      try {
        let previous = current.current;
        if (
          previous.pending_read.length ||
          previous.pending_through !== undefined
        ) {
          if (previous.pending_through !== undefined)
            await acknowledge([], previous.pending_through);
          for (let i = 0; i < previous.pending_read.length; i += 200)
            await acknowledge(previous.pending_read.slice(i, i + 200));
          previous = {
            ...previous,
            pending_read: [],
            pending_through: undefined,
          };
          if (stopped) return;
          await save(previous);
        }
        const latest = await request<NotificationFeed>(undefined, abort.signal);
        if (stopped) return;
        let fetched = latest.items;
        const oldestLoaded = previous.items.at(-1)?.sequence;
        let page = latest.items;
        // On reconnect, drain missed pages until we reach the previous inbox.
        // The socket is only a prompt to refetch this authoritative feed.
        while (
          oldestLoaded !== undefined &&
          page.length === 50 &&
          page.at(-1)!.sequence > oldestLoaded
        ) {
          const older = await request<NotificationFeed>(
            page.at(-1)!.sequence,
            abort.signal,
          );
          if (stopped) return;
          page = older.items;
          fetched = [...fetched, ...page];
        }
        const arrivals = initialized.current
          ? fetched.filter((n) => !known.current.has(n.id) && !n.read_at)
          : [];
        const changesTrip = fetched.some(
          (n) =>
            !known.current.has(n.id) &&
            [
              "TRIP_ASSIGNED",
              "STOCK_LOADED",
              "TRIP_UPDATED",
              "TRIP_CANCELLED",
              "RETURN_CONFIRMED",
            ].includes(n.type),
        );
        remember(fetched);
        if (changesTrip) tripChanged.current?.();
        initialized.current = true;
        setHasMore(page.length === 50);
        const stored = await save({
          ...latest,
          items: mergeNotifications(fetched, previous.items),
          pending_read: [],
          pending_through: undefined,
        });
        if (stopped) return;
        if (stored) setError("");
        if (arrivals.length && document.visibilityState === "visible") {
          setPaused(false);
          setToast({ item: arrivals[0]!, more: arrivals.length - 1 });
        }
      } catch (e) {
        if (!stopped) {
          setConnected(false);
          if (e instanceof Error && ["401", "403"].includes(e.message)) {
            setFeed(empty());
            setToast(undefined);
            setError(
              "Sign in with an authorized account to view notifications.",
            );
          } else
            setError("Notifications could not be synchronized. Try again.");
        }
      } finally {
        if (run === runId.current) busy.current = false;
        if (!stopped) setLoading(false);
      }
    };
    refresh.current = sync;
    const onFocus = () => {
      if (document.visibilityState === "visible") void sync();
    };
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    const onOffline = () => {
      setConnected(false);
      setToast(undefined);
    };
    window.addEventListener("offline", onOffline);
    const interval = setInterval(onFocus, 10000);
    const client = browserClient();
    const unsubscribe = client
      ? subscribeNotifications(
          client,
          profile.id,
          () => void sync(),
          setConnected,
        )
      : undefined;
    void sync();
    return () => {
      stopped = true;
      abort.abort();
      // This is the request generation counter, not a rendered DOM ref.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      runId.current++;
      if (!marking.current) busy.current = false;
      refresh.current = async () => {};
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onFocus);
      window.removeEventListener("offline", onOffline);
      document.removeEventListener("visibilitychange", onFocus);
      unsubscribe?.();
    };
    // Persistence and the cache change as the encrypted vault is saved. Keep one
    // listener per identity/connectivity state rather than resubscribing on save.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.id, online, unlocked]);

  useEffect(() => {
    if (!toast || paused) return;
    const timer = setTimeout(() => setToast(undefined), 10000);
    return () => clearTimeout(timer);
  }, [toast, paused]);
  useEffect(() => {
    if (!open && !toast) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      setToast(undefined);
      if (open) bell.current?.focus();
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [open, toast]);
  useEffect(() => {
    if (!open) return;
    panel.current?.focus();
    const dismiss = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);

  async function mark(item?: Notification) {
    if (!unlocked || busy.current) return;
    marking.current = true;
    busy.current = true;
    setLoading(true);
    panel.current?.focus();
    const previous = current.current;
    const through = item
      ? previous.pending_through
      : previous.items[0]?.sequence;
    const ids = item ? [...new Set([...previous.pending_read, item.id])] : [];
    const pending = { pending_read: ids, pending_through: through };
    const next = { ...applyPendingReads(previous, pending), ...pending };
    // Keep the queue inside the same authenticated driver's encrypted vault.
    let stored = false;
    try {
      stored = await save(next);
    } finally {
      marking.current = false;
      busy.current = false;
      if (mounted.current) setLoading(false);
    }
    if (stored && online) await refresh.current();
  }
  async function more() {
    if (busy.current || !online) return;
    busy.current = true;
    setLoading(true);
    try {
      const page = await request<NotificationFeed>(
        current.current.items.at(-1)?.sequence,
      );
      remember(page.items);
      const merged = {
        ...page,
        items: mergeNotifications(page.items, current.current.items),
      };
      await save({
        ...applyPendingReads(merged, current.current),
        pending_read: current.current.pending_read,
        pending_through: current.current.pending_through,
      });
      setHasMore(page.items.length === 50);
      setError("");
    } catch {
      setError("Notifications could not be synchronized. Try again.");
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }
  function link(item: Notification) {
    const href = notificationHref(item, profile.role);
    return (
      href && (
        <a
          href={href}
          className="inline-flex min-h-11 items-center text-sm font-semibold text-primary underline underline-offset-2"
          onClick={(event) => {
            if (!online) {
              event.preventDefault();
              setError("Reconnect to open these trip details.");
              return;
            }
            setOpen(false);
            setToast(undefined);
          }}
        >
          <T
            k={
              item.entity_type === "offline_operation"
                ? "View Review"
                : "View Trip"
            }
          />
        </a>
      )
    );
  }
  function details(item: Notification, compact = false) {
    const copy = notificationCopy[item.type];
    if (!copy) return null;
    return (
      <>
        <p className="font-semibold text-foreground">
          <T k={copy.title} />
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          <T k={copy.message} />
        </p>
        {item.type === "TRIP_ASSIGNED" && item.payload.assigned_not_ready && (
          <p className="mt-1 text-sm font-medium text-amber-900">
            <T k="Assigned; physical stock loading is pending." />
          </p>
        )}
        <p className="mt-2 text-xs">
          <T k="Trip #{0}" values={[item.payload.trip_number]} /> ·{" "}
          {item.payload.vehicle}
        </p>
        {!compact && (
          <>
            <p className="text-xs">
              <T k="Driver" />: {item.payload.driver}
            </p>
            <p className="text-xs">
              <T k="Scheduled delivery date" />:{" "}
              <DateValue value={item.payload.scheduled_date} />
            </p>
          </>
        )}
        {!compact && !!item.payload.counts?.length && (
          <ul className="mt-1 text-xs">
            {item.payload.counts.map((count, i) => (
              <li key={i}>
                {count.product} ·{" "}
                <Message
                  value={
                    count.stock_kind === "FULL_JAR"
                      ? "Full jars"
                      : count.stock_kind === "EMPTY_JAR"
                        ? "Empty jars"
                        : "Cartons"
                  }
                />
                : <Value value={count.quantity} />
              </li>
            ))}
          </ul>
        )}
        {compact && !!item.payload.counts?.length && (
          <p className="mt-1 text-xs">
            {["FULL_JAR", "EMPTY_JAR", "BOTTLE_CARTON"].map((kind) => {
              const quantity = item.payload
                .counts!.filter((c) => c.stock_kind === kind)
                .reduce((sum, c) => sum + c.quantity, 0);
              return quantity > 0 ? (
                <span key={kind} className="mr-2">
                  <Message
                    value={
                      kind === "FULL_JAR"
                        ? "Full jars"
                        : kind === "EMPTY_JAR"
                          ? "Empty jars"
                          : "Cartons"
                    }
                  />
                  : <Value value={quantity} />
                </span>
              ) : null;
            })}
          </p>
        )}
        <p className="mt-1 text-xs text-muted-foreground">
          <DateValue value={item.created_at} time />
        </p>
        {link(item)}
      </>
    );
  }
  return (
    <div
      ref={root}
      className="relative print:hidden"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          setOpen(false);
          setToast(undefined);
          bell.current?.focus();
        }
      }}
    >
      <Button
        ref={bell}
        type="button"
        variant="ghost"
        aria-label={
          t("Notifications") +
          (unlocked && feed.unread ? ` (${number(feed.unread)})` : "")
        }
        aria-expanded={open}
        aria-controls={panelId}
        aria-haspopup="dialog"
        className="relative size-11 shrink-0 p-0"
        data-testid="notification-bell"
        onClick={() => {
          setToast(undefined);
          setOpen(!open);
          if (!open) void refresh.current();
        }}
      >
        <Bell className="size-5" aria-hidden="true" />
        {unlocked && feed.unread > 0 && (
          <span
            data-testid="notification-badge"
            className="absolute -right-1 -top-1 min-w-5 rounded-full bg-primary px-1 text-center text-[11px] font-bold leading-5 text-white"
            aria-hidden="true"
          >
            {number(feed.unread > 99 ? "99+" : feed.unread)}
          </span>
        )}
      </Button>
      {open && (
        <div
          ref={panel}
          id={panelId}
          role="dialog"
          aria-label={t("Notifications")}
          tabIndex={-1}
          className="fixed inset-x-3 top-20 z-50 flex max-h-[min(36rem,calc(100dvh-7rem))] flex-col rounded-xl border border-border bg-white text-foreground shadow-lg focus-visible:outline-2 focus-visible:outline-primary sm:absolute sm:inset-x-auto sm:right-0 sm:top-14 sm:w-96"
          onBlur={(event) => {
            if (
              event.relatedTarget &&
              !root.current?.contains(event.relatedTarget as Node)
            )
              setOpen(false);
          }}
        >
          <div className="flex items-center justify-between gap-2 border-b border-border p-3">
            <h2 className="font-semibold">
              <T k="Notifications" />
            </h2>
            <Button
              variant="ghost"
              className="size-11 p-0"
              aria-label={t("Close notifications")}
              onClick={() => {
                setOpen(false);
                bell.current?.focus();
              }}
            >
              <X className="size-4" aria-hidden="true" />
            </Button>
          </div>
          <div className="border-b border-border px-3 pb-2 text-xs text-muted-foreground">
            <p role="status">
              <T
                k={
                  !unlocked
                    ? "Unlock the app to view cached notifications."
                    : !online
                      ? "Offline · Showing saved notifications"
                      : connected
                        ? "Live notifications connected"
                        : "Checking for notifications periodically"
                }
              />
            </p>
            {unlocked &&
              feed.pending_read.length + (feed.pending_through ? 1 : 0) > 0 && (
                <p>
                  <T k="Read changes will synchronize when connected." />
                </p>
              )}
            {unlocked && feed.unread > 0 && (
              <Button
                variant="ghost"
                className="mt-1 min-h-11 px-0 text-xs text-primary"
                onClick={() => void mark()}
                disabled={loading}
              >
                <CheckCheck className="mr-1 size-4" aria-hidden="true" />
                <T k="Mark All as Read" />
              </Button>
            )}
          </div>
          {error && (
            <div
              className="border-b border-border p-3 text-xs text-red-800"
              role="alert"
            >
              <T k={error} />
              <Button
                variant="ghost"
                onClick={() => void refresh.current()}
                disabled={!online || loading}
              >
                <T k="Retry" />
              </Button>
            </div>
          )}
          <div className="min-h-0 overflow-y-auto overscroll-contain">
            {unlocked && !feed.items.length && (
              <p className="p-6 text-center text-sm text-muted-foreground">
                <T
                  k={loading ? "Loading notifications…" : "No Notifications"}
                />
              </p>
            )}
            {unlocked &&
              feed.items.map((item) => {
                return (
                  <article
                    key={item.id}
                    data-testid="notification-item"
                    data-read={!!item.read_at}
                    className={`flex gap-3 border-b border-border p-3 last:border-b-0 ${item.read_at ? "bg-white" : "bg-teal-50"}`}
                  >
                    <NotificationIcon
                      type={item.type}
                      className="mt-1 size-4 shrink-0 text-primary"
                      aria-hidden="true"
                    />
                    <div className="min-w-0 flex-1 break-words">
                      {!item.read_at && (
                        <span className="text-xs font-semibold text-primary">
                          <T k="Unread" />
                        </span>
                      )}
                      {details(item)}
                      {!item.read_at && (
                        <Button
                          variant="ghost"
                          className="ml-2 min-h-11 px-2 text-xs"
                          onClick={() => void mark(item)}
                          disabled={loading}
                        >
                          <T k="Mark as Read" />
                        </Button>
                      )}
                    </div>
                  </article>
                );
              })}
            {unlocked && hasMore && online && (
              <Button
                variant="ghost"
                className="w-full"
                onClick={() => void more()}
                disabled={loading}
              >
                <T k="Load older notifications" />
              </Button>
            )}
          </div>
        </div>
      )}
      {toast && unlocked && online && (
        <div
          className="fixed inset-x-3 bottom-4 z-50 rounded-xl border border-teal-200 bg-white p-4 text-foreground shadow-lg sm:left-auto sm:right-4 sm:w-96"
          role="status"
          aria-live="polite"
          aria-atomic="true"
          data-testid="notification-toast"
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
          onFocusCapture={() => setPaused(true)}
          onBlurCapture={() => setPaused(false)}
        >
          <div className="flex items-start gap-3">
            <NotificationIcon
              type={toast.item.type}
              className="mt-1 size-5 shrink-0 text-primary"
              aria-hidden="true"
            />
            <div className="min-w-0 flex-1 break-words">
              {details(toast.item, true)}
              {toast.more > 0 && (
                <p className="text-xs text-muted-foreground">
                  <T
                    k="{0} more new notifications in your inbox."
                    values={[toast.more]}
                  />
                </p>
              )}
            </div>
            <Button
              variant="ghost"
              className="size-11 shrink-0 p-0"
              aria-label={t("Dismiss notification")}
              onClick={() => setToast(undefined)}
            >
              <X className="size-4" aria-hidden="true" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
