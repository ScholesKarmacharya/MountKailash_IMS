"use server";
import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { saveOperation, getDeliveryCustomer } from "@/services/operations";
import { saveFinance } from "@/services/finance";
import { saveDay } from "@/services/business-days";
import { saveAccount } from "@/services/accounts";
import { saveOfflineAdmin } from "@/services/offline-admin";
import { saveHouse } from "@/services/house";
import { offlineIdentity } from "@/services/offline";
export type OperationState = {
  error?: string;
  success?: string;
  id?: string;
} | null;
export async function deliveryCustomerAction(trip: string, customer: string) {
  try {
    return { data: await getDeliveryCustomer(trip, customer), error: null };
  } catch (error) {
    unstable_rethrow(error);
    return {
      data: null,
      error:
        error instanceof Error
          ? error.message
          : "Customer could not be loaded.",
    };
  }
}
export async function operationAction(
  _state: OperationState,
  form: FormData,
): Promise<OperationState> {
  return executeOperation(form, true);
}
export async function driverOperationAction(
  _state: OperationState,
  form: FormData,
): Promise<OperationState> {
  // The persistent dashboard refreshes confirmed data without replacing its
  // client layout, in-memory device key or the action's acknowledgement.
  return executeOperation(form, false);
}
async function executeOperation(
  form: FormData,
  refreshLayouts: boolean,
): Promise<OperationState> {
  try {
    if (!refreshLayouts) await offlineIdentity();
    const operation = String(form.get("operation"));
    const id = operation.startsWith("house:")
      ? await saveHouse(form)
      : operation.startsWith("offline:")
        ? await saveOfflineAdmin(form)
        : operation.startsWith("account:")
          ? await saveAccount(form)
          : operation.startsWith("day:")
            ? await saveDay(form)
            : operation.startsWith("finance:")
              ? await saveFinance(form)
              : await saveOperation(form);
    if (refreshLayouts) {
      revalidatePath("/admin", "layout");
      revalidatePath("/driver", "layout");
      revalidatePath("/account", "layout");
    }
    return { success: "Saved to the database.", id };
  } catch (error) {
    unstable_rethrow(error);
    return {
      error:
        error instanceof Error
          ? error.message
          : "Unable to save. Please retry.",
    };
  }
}
