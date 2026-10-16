import { cents, decimal } from "./money";
import type { PaymentDraft } from "./types";
export type DriverPaymentStatus =
  "PAID" | "FONEPAY" | "CREDIT" | "RETURN_ONLY" | "FREE_SUPPLY";
/** A driver new sale settles only its current invoice, using exact minor units. */
export function driverPaymentPlan({
  status,
  total,
  amount,
  customer,
}: {
  status: DriverPaymentStatus;
  total: string;
  amount: string;
  customer: string | null;
}): PaymentDraft[] {
  if (status === "FREE_SUPPLY") {
    if (!customer || cents(total) !== 0n || (amount && cents(amount) !== 0n))
      throw new Error(
        "Approved HOUSE status and eligible products are required for free delivery.",
      );
    return [];
  }
  if (status === "RETURN_ONLY") return [];
  if (status === "CREDIT") {
    if (!customer) throw new Error("Credit requires a registered customer.");
    return [];
  }
  if (!amount) throw new Error("Enter the total amount received.");
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(amount))
    throw new Error("Enter an amount with at most two decimals.");
  if (cents(amount) !== cents(total))
    throw new Error("Total amount received must equal the payable total.");
  return cents(amount) === 0n
    ? []
    : [
        {
          method: status === "FONEPAY" ? "FONEPAY" : "CASH",
          amount: decimal(cents(amount)),
          current_amount: decimal(cents(amount)),
          deposit_amount: "0.00",
          reference: "",
          allocations: [],
        },
      ];
}
