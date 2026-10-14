import { expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  applyPendingReads,
  mergeNotifications,
  notificationCopy,
  notificationHref,
  type Notification,
} from "@/domain/notifications";
import { subscribeNotifications } from "@/lib/notifications/realtime";
import { dictionaries } from "@/lib/i18n/messages";
const item = (sequence: number): Notification => ({
  id: crypto.randomUUID(),
  sequence,
  recipient_id: crypto.randomUUID(),
  type: "TRIP_ASSIGNED",
  entity_type: "trip",
  entity_id: crypto.randomUUID(),
  trip_id: crypto.randomUUID(),
  payload: {
    trip_number: 42,
    driver: "Driver A",
    vehicle: "BA 1",
    scheduled_date: "2026-10-15",
    assigned_not_ready: true,
  },
  created_at: "2026-10-14T00:00:00Z",
  read_at: null,
});
it("derives role-specific links without trusting stored URLs or malformed IDs", () => {
  const n = item(1);
  expect(notificationHref(n, "DRIVER")).toBe(`/driver/trips/${n.trip_id}`);
  expect(notificationHref(n, "ADMIN")).toBe(`/admin/trips/${n.trip_id}`);
  expect(
    notificationHref({ ...n, trip_id: "//evil.example" }, "DRIVER"),
  ).toBeNull();
  expect(
    notificationHref({ ...n, entity_type: "offline_operation" }, "ADMIN"),
  ).toBe("/admin/sync");
});
it("merges replayed arrivals and cross-device read updates without duplicate inbox rows", () => {
  const a = item(1),
    b = item(2),
    c = item(3);
  expect(
    mergeNotifications([c, { ...b, read_at: c.created_at }], [a, b]),
  ).toEqual([c, { ...b, read_at: c.created_at }, a]);
});
it("keeps cached offline read changes while preserving newer unread notifications", () => {
  const a = item(1),
    b = item(2);
  const feed = { items: [b, a], unread: 2, fetched_at: b.created_at };
  expect(applyPendingReads(feed, { pending_read: [a.id] }).unread).toBe(1);
  expect(
    applyPendingReads(feed, { pending_read: [], pending_through: 1 }).items[0]!
      .read_at,
  ).toBeNull();
  expect(
    applyPendingReads(feed, { pending_read: [], pending_through: 2 }).unread,
  ).toBe(0);
});
it("has English and Nepali copy for every stored event type", () => {
  Object.values(notificationCopy).forEach((copy) => {
    for (const key of [copy.title, copy.message]) {
      expect(dictionaries.en[key]).toBe(key);
      expect(dictionaries.ne[key]).toMatch(/[\u0900-\u097f]/);
    }
  });
});
it("subscribes only to the authenticated recipient, reconciles reconnects, and ignores callbacks after cleanup", () => {
  const handlers: { filter: Record<string, string>; callback: () => void }[] =
    [];
  let status: (value: string) => void = () => {};
  const channel = {
    on: vi.fn(
      (
        _event: string,
        filter: Record<string, string>,
        callback: () => void,
      ) => {
        handlers.push({ filter, callback });
        return channel;
      },
    ),
    subscribe: vi.fn((callback: typeof status) => {
      status = callback;
      return channel;
    }),
  };
  const client = {
    channel: vi.fn(() => channel),
    removeChannel: vi.fn(async () => {}),
  };
  const changed = vi.fn(),
    connected = vi.fn(),
    user = crypto.randomUUID();
  const stop = subscribeNotifications(
    client as unknown as SupabaseClient,
    user,
    changed,
    connected,
  );
  expect(handlers.map((h) => h.filter)).toEqual(
    ["INSERT", "UPDATE"].map((event) => ({
      event,
      schema: "public",
      table: "notifications",
      filter: `recipient_id=eq.${user}`,
    })),
  );
  status("SUBSCRIBED");
  handlers[0]!.callback();
  status("CHANNEL_ERROR");
  status("SUBSCRIBED");
  expect(changed).toHaveBeenCalledTimes(3);
  expect(connected.mock.calls.map((c) => c[0])).toEqual([true, false, true]);
  stop();
  handlers[1]!.callback();
  status("SUBSCRIBED");
  expect(changed).toHaveBeenCalledTimes(3);
  expect(client.removeChannel).toHaveBeenCalledOnce();
});
