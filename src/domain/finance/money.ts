// Exact minor units throughout the browser and service layer. PostgreSQL owns the final totals.
export function cents(value: string): bigint {
  if (!/^-?\d{1,30}(\.\d{1,2})?$/.test(value))
    throw new Error("Enter an amount with at most two decimals.");
  const negative = value.startsWith("-"),
    [whole, fraction = ""] = value.replace("-", "").split(".");
  return (
    (BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, "0"))) *
    (negative ? -1n : 1n)
  );
}
export function decimal(value: bigint): string {
  const abs = value < 0n ? -value : value;
  return `${value < 0n ? "-" : ""}${abs / 100n}.${String(abs % 100n).padStart(2, "0")}`;
}
export function sum(values: string[]): string {
  return decimal(values.reduce((s, v) => s + cents(v), 0n));
}
export function npr(value: string): string {
  const [whole, fraction] = decimal(cents(value)).split(".");
  return `NPR ${whole!.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${fraction}`;
}
export function allocations(
  amount: string,
  invoices: { id: string; available: string; date_label: string }[],
) {
  let remaining = cents(amount);
  if (remaining < 0n) throw new Error("Collection cannot be negative.");
  const result: { invoice_id: string; amount: string }[] = [];
  for (const invoice of [...invoices].sort(
    (a, b) =>
      a.date_label.localeCompare(b.date_label) || a.id.localeCompare(b.id),
  )) {
    const available = cents(invoice.available),
      take = remaining < available ? remaining : available;
    if (take > 0n) {
      result.push({ invoice_id: invoice.id, amount: decimal(take) });
      remaining -= take;
    }
  }
  if (remaining > 0n)
    throw new Error("Collection exceeds available outstanding credit.");
  return result;
}
