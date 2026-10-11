import { allocations, cents, decimal } from "./money";
import type { Credit, PaymentDraft } from "./types";
export function paymentPlan({
  selection,
  total,
  amount,
  oldAmount = "0",
  deposit = "0",
  fonepayPart = "0",
  reference = "",
  credit = [],
}: {
  selection: string;
  total: string;
  amount: string;
  oldAmount?: string;
  deposit?: string;
  fonepayPart?: string;
  reference?: string;
  credit?: Credit[];
}): PaymentDraft[] {
  const payable = cents(total),
    old = cents(oldAmount || "0"),
    dep = cents(deposit || "0"),
    fp = cents(fonepayPart || "0");
  const received =
    selection === "UNPAID"
      ? 0n
      : amount
        ? cents(amount)
        : selection === "PARTIAL"
          ? 0n
          : payable;
  if (
    received < 0n ||
    fp < 0n ||
    old < 0n ||
    dep < 0n ||
    received + fp > payable
  )
    throw new Error("Payment exceeds this invoice or is negative.");
  if (selection === "PARTIAL" && received + fp <= 0n)
    throw new Error("Enter a partial payment amount.");
  const result: PaymentDraft[] = [];
  if (received + old + dep > 0n)
    result.push({
      method: selection === "FONEPAY" ? "FONEPAY" : "CASH",
      amount: decimal(received + old + dep),
      current_amount: decimal(received),
      deposit_amount: decimal(dep),
      reference,
      allocations: allocations(decimal(old), credit),
    });
  if (fp > 0n)
    result.push({
      method: "FONEPAY",
      amount: decimal(fp),
      current_amount: decimal(fp),
      deposit_amount: "0.00",
      reference,
      allocations: [],
    });
  return result;
}
