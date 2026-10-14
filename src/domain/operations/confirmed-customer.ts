import type { DeliveryCustomerContext } from "./customer-context";
import { CustomerLookupError } from "./customer-errors";
import { uuid } from "@/domain/inventory/validation";
// Both the online response and encrypted offline snapshots use this contract.
// Missing/malformed authoritative fields must never imply free eligibility.
export function confirmedCustomerContext(
  value: unknown,
  expectedId?: string,
): DeliveryCustomerContext {
  try {
    const c = value as DeliveryCustomerContext;
    if (
      !c ||
      typeof c !== "object" ||
      !c.customer ||
      uuid(c.customer.id) !== (expectedId ?? c.customer.id) ||
      typeof c.customer.name !== "string" ||
      typeof c.customer.is_active !== "boolean"
    )
      throw new Error();
    for (const key of [
      "prices",
      "credit",
      "custody",
      "custody_history",
      "credit_history",
    ] as const)
      if (!Array.isArray(c[key])) throw new Error();
    const type = c.customer.supply_type ?? "REGULAR",
      status = c.customer.house_status ?? "NONE";
    if (
      !["REGULAR", "HOUSE"].includes(type) ||
      !["NONE", "PENDING", "APPROVED", "SUSPENDED"].includes(status) ||
      (type === "REGULAR" && status !== "NONE") ||
      (type === "HOUSE" &&
        (status === "NONE" || !Number.isInteger(c.customer.house_version)))
    )
      throw new Error();
    const validMoney = (v: unknown) =>
      typeof v === "string" && /^\d{1,12}\.\d{2}$/.test(v);
    if (
      c.prices.some(
        (p) => !validMoney(p.price) || p.customer_id !== c.customer.id,
      ) ||
      c.credit.some(
        (i) =>
          i.customer_id !== c.customer.id ||
          !validMoney(i.outstanding) ||
          !validMoney(i.available),
      )
    )
      throw new Error();
    if (
      c.house_products !== undefined &&
      (!Array.isArray(c.house_products) ||
        c.house_products.some(
          (p) =>
            !validMoney(p.reference_price) ||
            typeof p.house_eligible !== "boolean" ||
            !Number.isInteger(p.house_version),
        ))
    )
      throw new Error();
    return {
      ...c,
      customer: { ...c.customer, supply_type: type, house_status: status },
    };
  } catch {
    throw new CustomerLookupError("SCHEMA", 503);
  }
}
