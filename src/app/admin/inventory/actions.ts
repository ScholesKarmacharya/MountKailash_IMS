"use server";
import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { requirePermission } from "@/services/auth";
import {
  adjustStock,
  openInventoryDay,
  saveProduct,
} from "@/services/inventory";
export type SaveState = { error?: string; success?: string } | null;
async function perform(
  operation: () => Promise<string>,
  message: string,
): Promise<SaveState> {
  try {
    await operation();
  } catch (error) {
    unstable_rethrow(error);
    return {
      error:
        error instanceof Error
          ? error.message
          : "Unable to save. Please retry.",
    };
  }
  revalidatePath("/admin/inventory");
  revalidatePath("/admin/products");
  revalidatePath("/admin/dashboard");
  return { success: message };
}
export async function saveProductAction(_state: SaveState, form: FormData) {
  await requirePermission("product:manage");
  return perform(() => saveProduct(form), "Product saved.");
}
export async function adjustStockAction(_state: SaveState, form: FormData) {
  await requirePermission("stock:adjust");
  return perform(
    () => adjustStock(form),
    "Adjustment posted. Stock and history updated.",
  );
}
export async function openDayAction(_state: SaveState, form: FormData) {
  await requirePermission("day:open");
  return perform(() => openInventoryDay(form), "Business day opened.");
}
