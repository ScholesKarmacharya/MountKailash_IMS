import "server-only";
import { requirePermission } from "./auth";
import { createClient } from "@/lib/supabase/server";
import { houseFilter } from "@/domain/house/pricing";
import { uuid } from "@/domain/inventory/validation";
import { writeOperation } from "@/data-access/operations";
import type { HouseWorkspace } from "@/domain/house/types";
export async function getHouseWorkspace(
  params: Record<string, string | undefined>,
) {
  await requirePermission("admin:read");
  const filter = houseFilter(params);
  const { data, error } = await (
    await createClient()
  ).rpc("house_workspace", {
    p_start: filter.start,
    p_end: filter.end,
    p_customer: filter.customer,
    p_driver: filter.driver,
    p_product: filter.product,
  });
  if (error) {
    if (["42P01", "PGRST202", "PGRST205"].includes(error.code))
      return {
        available: false,
        products: [],
        customers: [],
        drivers: [],
        rows: [],
        adjustments: [],
      } satisfies HouseWorkspace;
    throw new Error("Free supply could not be loaded. Please retry.");
  }
  return { ...data, available: true } as HouseWorkspace;
}
export async function saveHouse(form: FormData) {
  await requirePermission("trip:assign");
  const text = (name: string, max = 500) => {
    const v = form.get(name);
    if (typeof v !== "string" || v.length > max)
      throw new Error(`Invalid ${name}.`);
    return v.trim();
  };
  const key = uuid(text("key", 36)),
    reason = text("reason");
  if (reason.length < 3) throw new Error("A specific reason is required.");
  if (text("operation") === "house:pricing") {
    const version = text("version", 10);
    if (!/^\d+$/.test(version)) throw new Error("Invalid product version.");
    return writeOperation({
      admin: true,
      rpc: "save_house_pricing",
      args: {
        p_product: uuid(text("product", 36)),
        p_price: text("price", 16),
        p_eligible: text("eligible", 5) === "true",
        p_reference: text("reference_price", 16),
        p_version: Number(version),
        p_reason: reason,
        p_key: key,
      },
    });
  }
  if (text("operation") === "house:adjust")
    return writeOperation({
      admin: true,
      rpc: "adjust_free_supply",
      args: {
        p_visit: uuid(text("visit", 36)),
        p_day: uuid(text("day", 36)),
        p_amount: text("amount", 16),
        p_direction: text("direction", 8),
        p_reason: reason,
        p_key: key,
      },
    });
  throw new Error("Unknown operation.");
}
