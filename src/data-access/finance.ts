import "server-only";
import { createClient } from "@/lib/supabase/server";
import {
  emptyFinance,
  type FinanceWorkspace,
  type Ledger,
} from "@/domain/finance/types";
import type { DateRange } from "@/domain/localization/calendar";
// Includes earlier entries to derive an exact opening balance, while excluding
// the next BS month's entries in PostgreSQL. Existing administrator RLS applies.
export async function readStatementLedger(
  customer: string,
  range: DateRange,
): Promise<Ledger[]> {
  const client = await createClient(),
    rows: Ledger[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await client
      .from("customer_ledger")
      .select(
        "id,customer_id,invoice_id,kind,amount::text,business_day_id,created_at",
      )
      .eq("customer_id", customer)
      .lt("created_at", range.end)
      .order("created_at")
      .order("id")
      .range(offset, offset + 499);
    if (error) throw new Error("Finance could not be loaded. Please retry.");
    for (const row of data)
      rows.push({ ...row, amount: String(row.amount) } as Ledger);
    if (data.length < 500) return rows;
  }
}
export async function readFinance(): Promise<FinanceWorkspace> {
  const client = await createClient();
  const { data, error } = await client.rpc("finance_workspace");
  if (error) {
    if (["42P01", "PGRST202", "PGRST205"].includes(error.code))
      return { ...emptyFinance };
    throw new Error("Finance could not be loaded. Please retry.");
  }
  return { ...emptyFinance, ...data, available: true } as FinanceWorkspace;
}
