import { uuid } from "@/domain/inventory/validation";
import { cents } from "./money";
import type { PaymentDraft } from "./types";
export function paymentDraft(value: unknown): PaymentDraft {
  if (!value || typeof value !== "object") throw new Error("Invalid payment.");
  const v = value as Record<string, unknown>;
  const amount = (name: string, optional = false) => {
    const s = v[name] ?? (optional ? "0" : null);
    if (
      typeof s !== "string" ||
      !/^\d{1,12}(\.\d{1,2})?$/.test(s) ||
      cents(s) < 0n
    )
      throw new Error("Invalid payment amount.");
    return s;
  };
  if (v.method !== "CASH" && v.method !== "FONEPAY")
    throw new Error("Invalid payment method.");
  if (typeof v.reference !== "string" && v.reference !== undefined)
    throw new Error("Invalid reference.");
  const ref = String(v.reference ?? "");
  if (ref.length > 200) throw new Error("Reference too long.");
  const list = v.allocations ?? [];
  if (!Array.isArray(list) || list.length > 200)
    throw new Error("Invalid allocations.");
  return {
    method: v.method,
    amount: amount("amount"),
    current_amount: amount("current_amount", true),
    deposit_amount: amount("deposit_amount", true),
    reference: ref,
    allocations: list.map((a) => {
      if (
        !a ||
        typeof a !== "object" ||
        typeof a.amount !== "string" ||
        cents(a.amount) <= 0n
      )
        throw new Error("Invalid allocation.");
      return { invoice_id: uuid(a.invoice_id), amount: a.amount };
    }),
  };
}
export function financeCommand(form: FormData) {
  const text = (key: string, max = 500) => {
    const v = form.get(key);
    if (typeof v !== "string" || v.length > max)
      throw new Error(`Invalid ${key}.`);
    return v.trim();
  };
  const id = (key: string) => uuid(text(key, 36));
  const key = id("key"),
    operation = text("operation", 20).replace("finance:", "");
  const reason = () => {
    const r = text("reason");
    if (r.length < 3) throw new Error("A specific reason is required.");
    return r;
  };
  const amount = (key: string) => {
    const v = text(key, 16);
    if (cents(v) < 0n) throw new Error("Amount cannot be negative.");
    return v;
  };
  const version = () => {
    const v = text("version", 10);
    if (!/^\d+$/.test(v)) throw new Error("Invalid version.");
    return Number(v);
  };
  let data: Record<string, unknown>;
  switch (operation) {
    case "PAYMENT":
      data = {
        ...paymentDraft(JSON.parse(text("payment_data", 60000))),
        trip: id("trip"),
        customer: text("customer", 36) ? id("customer") : null,
        ...(form.has("invoice") ? { invoice: id("invoice") } : {}),
      };
      break;
    case "VERIFY":
      data = {
        payment: id("payment"),
        day: id("day"),
        decision: text("decision", 7),
        reference: text("reference", 200),
        reason: reason(),
      };
      break;
    case "REVERSE":
      data = { payment: id("payment"), day: id("day"), reason: reason() };
      break;
    case "REFUND":
      data = {
        customer: id("customer"),
        day: id("day"),
        amount: amount("amount"),
        reason: reason(),
      };
      break;
    case "ADJUST":
      data = {
        invoice: id("invoice"),
        day: id("day"),
        direction: text("direction", 6),
        subtotal_amount: amount("subtotal_amount"),
        tax_amount: amount("tax_amount"),
        reason: reason(),
      };
      break;
    case "COMPANY":
      data = {
        version: version(),
        name: text("name", 120),
        address: text("address"),
        phone: text("phone", 40),
        registration: text("registration", 120),
        tax_mode: text("tax_mode", 12),
        tax_label: text("tax_label", 100),
        tax_rate: amount("tax_rate"),
        reason: reason(),
      };
      break;
    case "BILLING":
      data = {
        customer: id("customer"),
        version: version(),
        account_type: text("account_type", 20),
        due_days: text("due_days", 3),
        deposit_mode: text("deposit_mode", 10),
        reason: reason(),
      };
      break;
    case "PRICE":
      data = {
        customer: id("customer"),
        product: id("product"),
        version: version(),
        price: amount("price"),
        active: text("active", 5) === "true",
        reason: reason(),
      };
      break;
    default:
      throw new Error("Invalid finance operation.");
  }
  return {
    rpc: "finance_command",
    args: { p_operation: operation, p_data: data, p_key: key },
    admin: operation !== "PAYMENT",
  };
}
