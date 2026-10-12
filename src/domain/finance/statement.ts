import { cents, decimal } from "./money";
import type { FinanceWorkspace } from "./types";
import type { DateRange } from "@/domain/localization/calendar";
/** Journal dates define a calendar-period statement; balances remain cumulative. */
export function creditStatement(
  finance: FinanceWorkspace,
  customer: string,
  range: DateRange,
) {
  const entries = finance.ledger
    .filter((l) => l.customer_id === customer)
    .sort(
      (a, b) =>
        a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id),
    );
  let opening = 0n,
    change = 0n;
  const start = Date.parse(range.start),
    end = Date.parse(range.end);
  const rows = entries.filter((l) => {
    const instant = Date.parse(l.created_at);
    if (instant < start) opening += cents(l.amount);
    return instant >= start && instant < end;
  });
  for (const row of rows) change += cents(row.amount);
  return {
    opening: decimal(opening),
    change: decimal(change),
    closing: decimal(opening + change),
    rows,
  };
}
