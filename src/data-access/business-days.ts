import "server-only";
import { createClient } from "@/lib/supabase/server";
export type BusinessDay = {
  id: string;
  date_label: string;
  opened_at: string;
  status: "OPEN" | "CLOSING_REVIEW";
};
export async function readActiveBusinessDay(): Promise<BusinessDay | null> {
  const client = await createClient();
  const { data, error } = await client
    .from("business_days")
    .select("id,date_label,opened_at,status")
    .in("status", ["OPEN", "CLOSING_REVIEW"])
    .maybeSingle();
  if (error)
    throw new Error("Business day could not be loaded. Please try again.");
  return data as BusinessDay | null;
}
