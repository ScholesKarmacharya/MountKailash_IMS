import type { Role } from "./auth/roles";

export type NotificationType =
  | "TRIP_ASSIGNED"
  | "STOCK_LOADED"
  | "TRIP_UPDATED"
  | "TRIP_CANCELLED"
  | "RETURN_SUBMITTED"
  | "RETURN_CONFIRMED"
  | "STOCK_DISCREPANCY"
  | "SYNC_REVIEW"
  | "TRANSACTION_REVIEW";
export type Notification = {
  id: string;
  sequence: number;
  recipient_id: string;
  type: NotificationType;
  entity_type: "trip" | "offline_operation";
  entity_id: string;
  trip_id: string;
  payload: {
    trip_number: number;
    driver: string;
    vehicle: string;
    scheduled_date: string;
    assigned_not_ready: boolean;
    counts?: { product: string; stock_kind: string; quantity: number }[];
    action?: string;
    submitted_at?: string | null;
    operation_kind?: string;
  };
  created_at: string;
  read_at: string | null;
};
export type NotificationFeed = {
  items: Notification[];
  unread: number;
  fetched_at: string;
};
export type NotificationCache = NotificationFeed & {
  pending_read: string[];
  pending_through?: number;
};
export const notificationCopy: Record<
  NotificationType,
  { title: string; message: string }
> = {
  TRIP_ASSIGNED: {
    title: "New Trip Assigned",
    message: "A delivery trip has been assigned to you.",
  },
  STOCK_LOADED: {
    title: "Stock Loading Confirmed",
    message: "The warehouse has confirmed these loaded quantities.",
  },
  TRIP_UPDATED: {
    title: "Trip Updated",
    message: "Your trip schedule or carryover authorization has changed.",
  },
  TRIP_CANCELLED: {
    title: "Trip Cancelled",
    message: "Your assigned trip has been cancelled.",
  },
  RETURN_SUBMITTED: {
    title: "Warehouse Return Awaiting Confirmation",
    message:
      "The driver submitted these return counts. Physical warehouse confirmation is pending.",
  },
  RETURN_CONFIRMED: {
    title: "Warehouse Return Confirmed",
    message: "Your warehouse return has been verified and confirmed.",
  },
  STOCK_DISCREPANCY: {
    title: "Trip Stock Needs Review",
    message:
      "Warehouse counts differ from expected stock. The return remains unconfirmed.",
  },
  SYNC_REVIEW: {
    title: "Synchronization Needs Review",
    message:
      "A saved device record needs warehouse review before synchronization can continue.",
  },
  TRANSACTION_REVIEW: {
    title: "Transaction Needs Review",
    message:
      "A saved transaction could not be confirmed. Review the original device record.",
  },
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Never trust a URL embedded in a stored payload. Route targets are derived
// from a validated entity ID; the existing destination enforces trip access.
export function notificationHref(
  item: Notification,
  role: Role,
): string | null {
  if (!uuid.test(item.trip_id)) return null;
  if (role === "ADMIN" && item.entity_type === "offline_operation")
    return "/admin/sync";
  if (role === "DRIVER" && item.entity_type === "offline_operation")
    return "/driver/sales";
  return `/${role === "ADMIN" ? "admin" : "driver"}/trips/${item.trip_id}`;
}
export function mergeNotifications(
  latest: Notification[],
  existing: Notification[],
) {
  const items = new Map(existing.map((item) => [item.id, item]));
  latest.forEach((item) => items.set(item.id, item));
  return [...items.values()].sort((a, b) => b.sequence - a.sequence);
}
export function applyPendingReads(
  feed: NotificationFeed,
  cache: Pick<NotificationCache, "pending_read" | "pending_through">,
): NotificationFeed {
  let changed = 0;
  const items = feed.items.map((item) => {
    if (
      !item.read_at &&
      (cache.pending_read.includes(item.id) ||
        (cache.pending_through !== undefined &&
          item.sequence <= cache.pending_through))
    ) {
      changed++;
      return { ...item, read_at: feed.fetched_at };
    }
    return item;
  });
  return {
    ...feed,
    items,
    unread:
      cache.pending_through !== undefined
        ? items.filter((n) => !n.read_at).length
        : Math.max(0, feed.unread - changed),
  };
}
