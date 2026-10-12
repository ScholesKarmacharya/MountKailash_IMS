import { uuid } from "@/domain/inventory/validation";
import { paymentDraft } from "@/domain/finance/commands";
export type Operation =
  | "customer"
  | "delivery-customer"
  | "vehicle"
  | "driver"
  | "create"
  | "route"
  | "load"
  | "start"
  | "review"
  | "cancel"
  | "visit"
  | "submit"
  | "reconcile"
  | "custody";
export type Command = {
  rpc: string;
  args: Record<string, unknown>;
  admin: boolean;
};
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
    case "customer":
      return {
        admin: true,
        rpc: "save_customer",
        args: {
          ...master(),
          p_name: str("name", 120),
          p_shop: str("shop_name", 160),
          p_phone: str("phone", 40),
          p_address: str("address", 500),
          p_notes: str("notes"),
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
    case "create":
      return {
        admin: true,
        rpc: "create_trip",
        args: {
          p_id: id("id"),
          p_driver: id("driver"),
          p_vehicle: id("vehicle"),
          p_day: id("day"),
          p_customers: [],
          p_notes: str("notes"),
          ...common,
        },
      };
    case "route":
      throw new Error(
        "Drivers choose customers during delivery; preassignment is disabled.",
      );
    case "delivery-customer":
      return {
        admin: false,
        rpc: "save_delivery_customer",
        args: {
          p_trip: id("trip"),
          p_id: id("id"),
          p_name: str("name", 120),
          p_shop: str("shop_name", 160),
          p_phone: str("phone", 40),
          p_address: str("address", 500),
          p_version: integer("version"),
          p_duplicate_confirmed: form.get("duplicate_confirmed") === "on",
          ...common,
        },
      };
    case "load":
      return {
        admin: true,
        rpc: "load_trip",
        args: { p_trip: id("trip"), p_items: json("items"), ...common },
      };
    case "start":
    case "review":
    case "cancel":
      return {
        admin: operation !== "start",
        rpc: "transition_trip",
        args: {
          p_trip: id("trip"),
          p_action: operation.toUpperCase(),
          p_reason: operation === "start" ? "" : reason(),
          ...common,
        },
      };
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
