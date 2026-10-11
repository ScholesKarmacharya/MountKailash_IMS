"use server";
import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { saveOperation } from "@/services/operations";
export type OperationState = {
  error?: string;
  success?: string;
  id?: string;
} | null;
export async function operationAction(
  _state: OperationState,
  form: FormData,
): Promise<OperationState> {
  try {
    const id = await saveOperation(form);
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
