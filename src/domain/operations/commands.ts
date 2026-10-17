import { uuid } from "@/domain/inventory/validation";
import { paymentDraft } from "@/domain/finance/commands";
import { dateFilter } from "@/domain/business-days/commands";
export type Operation =
  | "instant"
  | "instant-convert"
  | "customer"
  | "delivery-customer"
  | "delivery-contact"
  | "vehicle"
  | "driver"
  | "create"
  | "prepare-trip"
  | "route"
  | "load"
  | "start"
  | "review"
  | "cancel"
  | "continue"
  | "reschedule"
  | "unload-cancel"
  | "carryover"
  | "visit"
  | "driver-visit"
  | "submit"
  | "reconcile"
  | "custody";
export type Command = {
  rpc: string;
  args: Record<string, unknown>;
  admin: boolean;
};
function invalidSchedule(): never {
  throw new Error("Choose a valid scheduled delivery date.");
}
// Whitelist every RPC argument. Browser prices, roles and actor IDs are never forwarded.
export function parseCommand(form: FormData): Command {
  const str = (name: string, max = 2000) => {
    const value = form.get(name);
    if (typeof value !== "string" || value.length > max)
      throw new Error(`Invalid ${name}.`);
    return value.trim();
  };
  const id = (name: string) => uuid(str(name, 36));
  const integer = (name: string, min = 0) => {
    const value = str(name, 12);
    if (
      !/^-?\d+$/.test(value) ||
      !Number.isSafeInteger(Number(value)) ||
      Number(value) < min ||
      Number(value) > 1000000000
    )
      throw new Error(`Invalid ${name}.`);
    return Number(value);
  };
  const json = (name: string) => {
    try {
      return JSON.parse(str(name, 60000)) as unknown;
    } catch {
      throw new Error(`Invalid ${name}.`);
    }
  };
  const key = id("key"),
    operation = str("operation", 20);
  const common = { p_key: key };
  const reason = () => {
    const value = str("reason", 500);
    if (value.length < 3)
      throw new Error("A reason of at least 3 characters is required.");
    return value;
  };
  const master = () => ({
    p_id: id("id"),
    p_active: str("active", 5) === "true",
    p_version: integer("version"),
    p_reason: reason(),
    ...common,
  });
  switch (operation) {
    case "instant-convert":
      return {
        admin: true,
        rpc: "convert_instant_customer",
        args: { p_id: id("id"), p_reason: reason(), ...common },
      };
    case "instant":
      return {
        admin: false,
        rpc: "post_instant_delivery",
        args: {
          p_trip: id("trip"),
          p_id: id("id"),
          p_name: str("event_name", 120),
          p_phone: str("phone", 40),
          p_location: str("location", 500),
          p_items: json("items"),
          p_status: str("payment_status", 11),
          p_received: str("received_amount", 16) || null,
          p_notes: str("notes"),
          ...common,
        },
      };
    case "customer":
      return {
        admin: true,
        rpc: form.has("supply_type") ? "save_house_customer" : "save_customer",
        args: {
          ...master(),
          p_name: str("name", 120),
          p_shop: str("shop_name", 160),
          p_phone: str("phone", 40),
          p_address: str("address", 500),
          p_notes: str("notes"),
          ...(form.has("supply_type")
            ? {
                p_contact_person: str("contact_person", 120),
                p_supply_type: str("supply_type", 7),
                p_house_status: str("house_status", 9),
              }
            : {}),
        },
      };
    case "vehicle":
      return {
        admin: true,
        rpc: "save_vehicle",
        args: {
          ...master(),
          p_plate: str("plate_number", 40),
          p_description: str("description", 500),
        },
      };
    case "driver":
      return {
        admin: true,
        rpc: "save_driver",
        args: { ...master(), p_name: str("name", 120) },
      };
    case "prepare-trip": {
      const intent = str("intent", 7);
      if (!["DRAFT", "CONFIRM"].includes(intent))
        throw new Error(
          "Choose whether to save a draft or confirm physical loading.",
        );
      return {
        admin: true,
        rpc: "create_trip_with_load",
        args: {
          p_id: id("id"),
          p_driver: id("driver"),
          p_vehicle: id("vehicle"),
          p_day: id("day"),
          p_scheduled: dateFilter(str("scheduled", 10)) ?? invalidSchedule(),
          p_notes: str("notes"),
          p_items: json("items"),
          p_confirm: intent === "CONFIRM",
          ...common,
        },
      };
    }
    case "create":
      return {
        admin: true,
        rpc: form.has("scheduled") ? "schedule_trip" : "create_trip",
        args: {
          p_id: id("id"),
          p_driver: id("driver"),
          p_vehicle: id("vehicle"),
          p_day: id("day"),
          ...(form.has("scheduled")
            ? {
                p_scheduled:
                  dateFilter(str("scheduled", 10)) ?? invalidSchedule(),
              }
            : { p_customers: [] }),
          p_notes: str("notes"),
          ...common,
        },
      };
    case "route":
      throw new Error(
        "Drivers choose customers during delivery; preassignment is disabled.",
      );
    case "delivery-customer":
    case "delivery-contact":
      return {
        admin: false,
        rpc:
          operation === "delivery-contact"
            ? form.has("supply_type")
              ? "request_house_contact"
              : "save_delivery_contact"
            : "save_delivery_customer",
        args: {
          p_trip: id("trip"),
          p_id: id("id"),
          p_name: str("name", 120),
          p_shop: str("shop_name", 160),
          p_phone: str("phone", 40),
          p_address: str("address", 500),
          p_version: integer("version"),
          p_duplicate_confirmed: form.get("duplicate_confirmed") === "on",
          ...(operation === "delivery-contact"
            ? {
                p_contact_person: str("contact_person", 120),
                p_customer_type: str("customer_type", 80),
                p_delivery_notes: str("delivery_notes"),
                ...(form.has("supply_type")
                  ? { p_supply_type: str("supply_type", 7) }
                  : {}),
              }
            : {}),
          ...common,
        },
      };
    case "load":
      return {
        admin: true,
        rpc:
          form.get("draft") === "true" ? "save_trip_draft_load" : "load_trip",
        args: { p_trip: id("trip"), p_items: json("items"), ...common },
      };
    case "start":
    case "continue":
    case "review":
    case "cancel":
      return {
        admin: !["start", "continue"].includes(operation),
        rpc: "transition_trip",
        args: {
          p_trip: id("trip"),
          p_action: operation.toUpperCase(),
          p_reason: ["start", "continue"].includes(operation) ? "" : reason(),
          ...common,
        },
      };
    case "reschedule":
    case "unload-cancel":
    case "carryover":
      return {
        admin: true,
        rpc: "trip_preparation_command",
        args: {
          p_trip: id("trip"),
          p_action: operation.replaceAll("-", "_").toUpperCase(),
          p_scheduled:
            operation === "reschedule"
              ? (dateFilter(str("scheduled", 10)) ?? invalidSchedule())
              : null,
          p_counts: operation === "unload-cancel" ? json("counts") : null,
          p_reason: reason(),
          ...common,
        },
      };
    case "driver-visit": {
      const status = str("payment_status", 11),
        received = str("received_amount", 16);
      if (
        !["PAID", "FONEPAY", "CREDIT", "RETURN_ONLY", "FREE_SUPPLY"].includes(
          status,
        )
      )
        throw new Error("Choose Paid or Credit.");
      if (
        ["PAID", "FONEPAY"].includes(status) &&
        !/^\d{1,12}(\.\d{1,2})?$/.test(received)
      )
        throw new Error("Enter the total amount received.");
      if (!["PAID", "FONEPAY"].includes(status) && received)
        throw new Error(
          "Credit or return-only visits cannot collect a new payment.",
        );
      const customer = str("customer", 36) ? id("customer") : null;
      if (status === "CREDIT" && !customer)
        throw new Error("Credit requires a registered customer.");
      return {
        admin: false,
        rpc: "post_driver_delivery",
        args: {
          p_trip: id("trip"),
          p_customer: customer,
          p_walk_name: str("walk_name", 120),
          p_walk_phone: str("walk_phone", 40),
          p_items: json("items"),
          p_status: status,
          p_received: received || null,
          p_notes: str("notes"),
          ...common,
        },
      };
    }
    case "visit":
      return {
        admin: false,
        rpc: "post_trip_visit",
        args: {
          p_trip: id("trip"),
          p_customer: str("customer", 36) ? id("customer") : null,
          p_walk_name: str("walk_name", 120),
          p_walk_phone: str("walk_phone", 40),
          p_items: json("items"),
          p_payment: {
            selection: str("payment", 10),
            reported_amount: str("amount", 16) || null,
            reference: str("reference", 200),
            ...(form.has("finance_payments")
              ? {
                  payments: (json("finance_payments") as unknown[]).map(
                    paymentDraft,
                  ),
                }
              : {}),
          },
          p_notes: str("notes"),
          ...common,
        },
      };
    case "submit":
      return {
        admin: false,
        rpc: "submit_trip",
        args: { p_trip: id("trip"), p_counts: json("counts"), ...common },
      };
    case "reconcile":
      return {
        admin: true,
        rpc: "reconcile_trip",
        args: {
          p_trip: id("trip"),
          p_counts: json("counts"),
          p_reason: reason(),
          p_accept_variance: form.get("accept_variance") === "on",
          ...common,
        },
      };
    case "custody":
      return {
        admin: true,
        rpc: "adjust_customer_custody",
        args: {
          p_customer: id("customer"),
          p_product: id("product"),
          p_delta: integer("delta", -1000000000),
          p_day: id("day"),
          p_reason: reason(),
          ...common,
        },
      };
    default:
      throw new Error("Unknown operation.");
  }
}
