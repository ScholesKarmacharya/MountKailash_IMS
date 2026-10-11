import "server-only";
import { createClient } from "@/lib/supabase/server";
import { emptyFinance, type FinanceWorkspace } from "@/domain/finance/types";
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
