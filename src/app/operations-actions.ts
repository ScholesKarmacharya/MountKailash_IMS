"use server";
import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { saveOperation, getDeliveryCustomer } from "@/services/operations";
import { saveFinance } from "@/services/finance";
import { saveDay } from "@/services/business-days";
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
  try {
    const operation = String(form.get("operation"));
    const id = operation.startsWith("day:")
      ? await saveDay(form)
      : operation.startsWith("finance:")
        ? await saveFinance(form)
        : await saveOperation(form);
    revalidatePath("/admin", "layout");
    revalidatePath("/driver", "layout");
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
