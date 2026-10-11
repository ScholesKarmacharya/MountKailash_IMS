import { uuid, stockKinds } from "@/domain/inventory/validation";
import type { Command } from "@/domain/operations/commands";
export function dayCommand(form: FormData): Command {
  const text = (name: string, max = 500) => {
    const value = form.get(name);
    if (typeof value !== "string" || value.length > max)
      throw new Error(`Invalid ${name}.`);
    return value.trim();
  };
  const id = (name: string) => uuid(text(name, 36));
  const integer = (name: string, signed = false) => {
    const value = text(name, 12);
    if (
      !(signed ? /^-?\d{1,10}$/ : /^\d{1,10}$/).test(value) ||
      Math.abs(Number(value)) > 1000000000
    )
      throw new Error(`Invalid ${name}.`);
    return Number(value);
  };
  const reason = () => {
    const value = text("reason");
    if (value.length < 3) throw new Error("A specific reason is required.");
    return value;
  };
  const p_day = id("day"),
    p_key = id("key"),
    operation = text("operation", 30).replace("day:", "");
  if (operation === "REFILL" || operation === "DAMAGE") {
    const kind = text("stock_kind", 20);
    if (kind !== "FULL_JAR" && kind !== "EMPTY_JAR")
      throw new Error("Choose a jar state.");
    const quantity = integer("quantity");
    if (!quantity || (operation === "REFILL" && kind !== "EMPTY_JAR"))
      throw new Error(
        "Choose a positive eligible empty-jar quantity for refilling.",
      );
    return {
      rpc: "process_warehouse_jars",
      admin: true,
      args: {
        p_day,
        p_key,
        p_product: id("product"),
        p_operation: operation,
        p_kind: kind,
        p_quantity: quantity,
        p_reason: reason(),
      },
    };
  }
  let data: Record<string, unknown>;
  if (operation === "STOCK_CORRECTION") {
    const kind = text("stock_kind", 20),
      delta = integer("delta", true);
    if (!stockKinds.includes(kind as (typeof stockKinds)[number]) || !delta)
      throw new Error("Choose a stock state and a nonzero correction.");
    data = {
      posting_day: id("posting_day"),
      product: id("product"),
      stock_kind: kind,
      delta,
      reason: reason(),
    };
  } else {
    data = { version: integer("version") };
    if (operation === "RESUME") data.reason = reason();
    else if (operation === "CLOSE") {
      const cash = text("cash_counted", 17),
        notes = text("notes", 2000);
      if (!/^-?\d{1,12}(\.\d{1,2})?$/.test(cash))
        throw new Error("Enter signed net cash with at most two decimals.");
      if (notes.length < 3)
        throw new Error("Record the reconciliation evidence or closing notes.");
      data = { ...data, cash_counted: cash, notes };
      for (const field of [
        "cash_checked",
        "fonepay_checked",
        "stock_checked",
        "balances_checked",
        "confirmed",
      ]) {
        if (form.get(field) !== "on")
          throw new Error("Confirm every closing checklist item.");
        data[field] = true;
      }
    } else if (operation !== "REVIEW")
      throw new Error("Unknown business-day operation.");
  }
  return {
    rpc: "business_day_command",
    admin: true,
    args: { p_operation: operation, p_day, p_key, p_data: data },
  };
}
export function dateFilter(value: unknown): string | null {
  if (value === undefined || value === "") return null;
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString().slice(0, 10) !== value
  )
    throw new Error("Choose a valid date.");
  return value;
}
