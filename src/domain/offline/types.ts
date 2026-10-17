import type { Profile } from "@/domain/auth/roles";
import type {
  Workspace,
  Count,
  Customer,
  Trip,
} from "@/domain/operations/types";
import type { FinanceWorkspace } from "@/domain/finance/types";
import type { PaymentDraft } from "@/domain/finance/types";
import type { DeliveryCustomerContext } from "@/domain/operations/customer-context";
import type { Locale } from "@/domain/localization/locale";
import type { NotificationCache } from "@/domain/notifications";
import type { InstantContact, InstantWorkspace } from "@/domain/instant";

export type OfflineKind =
  | "CUSTOMER"
  | "CONTACT"
  | "DELIVERY"
  | "PAYMENT"
  | "SUBMIT"
  | "PAUSE"
  | "INSTANT";
export type CollectionDraft = PaymentDraft & { customer: string };
export type QueueStatus = "PENDING" | "SYNCED" | "NEEDS_REVIEW";
export type Envelope = {
  version: 1;
  id: string;
  trip: string;
  sequence: number;
  kind: OfflineKind;
  occurredAt: string;
  payload: string;
  fingerprint: string;
};
export type Receipt = {
  id: string;
  trip: string;
  sequence: number;
  fingerprint: string;
  status: "CONFIRMED" | "NEEDS_REVIEW" | "RETRYABLE" | "REJECTED";
  result: string | null;
  customer?: string | null;
  message: string | null;
  processedAt: string;
};
export type LocalOperation = Envelope & {
  status: QueueStatus;
  attempts: number;
  retryAt: number;
  message?: string;
  acknowledgement?: Receipt;
};
export type DeviceRound = {
  trip_id: string;
  device_id: string;
  driver_id: string;
  phase: "PREPARED" | "ACTIVE" | "PAUSED" | "SEALED" | "EXCEPTION";
  confirmed_sequence: number;
  registered_at: string;
  last_seen_at: string;
  reported_pending: number;
  checkpoint_at: string | null;
  offline_device_reset_pending?: boolean;
};
export type OfflineSnapshot = {
  instant?: InstantWorkspace;
  profile: Profile;
  locale: Locale;
  workspace: Workspace;
  finance: FinanceWorkspace;
  contexts: DeliveryCustomerContext[];
  receipts: Receipt[];
  // Server-received, unconfirmed envelopes retained during a device transfer.
  retainedOperations?: Envelope[];
  round: DeviceRound;
  fetchedAt: string;
  authorizedUntil: string;
};
export type LocalState = {
  version: 1;
  user: string;
  device: string;
  token: string;
  locale: Locale;
  snapshot: OfflineSnapshot;
  operations: LocalOperation[];
  // Confirmed history inherited by a replacement installation. Local operation
  // envelopes always keep their original UUID, sequence, payload and hash.
  inheritedReceipts?: Receipt[];
  sealed: boolean;
  // Online selection retired this writer. Evidence and original envelopes stay
  // intact; this durable guard also stops stale tabs/offline reopening writing.
  retired?: { status: Trip["status"]; cancelled: boolean; at: string };
  paused?: boolean;
  lastSynced?: string;
  notifications?: NotificationCache;
  recovery: { at: string; operation?: string; action: string }[];
};
export type DeliveryDraft = {
  instant?: InstantContact;
  customer: string | null;
  walk_name: string;
  walk_phone: string;
  items: {
    product_id: string;
    full_jars: number;
    empty_jars: number;
    cartons: number;
  }[];
  status: "PAID" | "FONEPAY" | "CREDIT" | "RETURN_ONLY" | "FREE_SUPPLY";
  house?: {
    version: number;
    products: {
      product_id: string;
      version: number;
      eligible: boolean;
      reference_price: string;
    }[];
  };
  received: string | null;
  notes: string;
  total: string;
  prices: { product_id: string; price: string }[];
  custody: { product_id: string; quantity: number }[];
};
// Editable values only. The device recomputes prices, custody and HOUSE evidence
// from its confirmed snapshot, and always requires a new review before saving.
export type DeliveryInput = Pick<
  DeliveryDraft,
  "customer" | "walk_name" | "walk_phone" | "items" | "received" | "notes"
> & { credit: boolean };
export type ContactDraft = Pick<
  Customer,
  "id" | "name" | "shop_name" | "phone" | "address" | "version"
> &
  Pick<
    Customer,
    "supply_type" | "contact_person" | "customer_type" | "delivery_notes"
  >;
export type ReturnDraft = {
  counts: Count[];
  manifest: { id: string; fingerprint: string }[];
};
