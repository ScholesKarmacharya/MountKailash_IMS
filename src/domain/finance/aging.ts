import { sum } from "./money";
import type { Credit } from "./types";
export function creditAging(invoices: Credit[], today: string) {
  const bins: { label: string; amounts: string[] }[] = [
    { label: "Not yet due", amounts: [] },
    { label: "1–30 days overdue", amounts: [] },
    { label: "31–60 days overdue", amounts: [] },
    { label: "61–90 days overdue", amounts: [] },
    { label: "Over 90 days", amounts: [] },
    { label: "Due unconfigured", amounts: [] },
  ];
  for (const i of invoices) {
    const days = i.due_date
      ? Math.floor(
          (Date.parse(today + "T00:00:00Z") -
            Date.parse(i.due_date + "T00:00:00Z")) /
            86400000,
        )
      : null;
    bins[
      days === null
        ? 5
        : days <= 0
          ? 0
          : days <= 30
            ? 1
            : days <= 60
              ? 2
              : days <= 90
                ? 3
                : 4
    ]!.amounts.push(i.outstanding);
  }
  return bins.map((b) => ({ label: b.label, amount: sum(b.amounts) }));
}
