"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { resetDriverOfflineAccess } from "@/services/offline-admin";
import { OfflineServerError } from "@/data-access/offline";

export type OfflineAccessResetState = {
  success?: string;
  error?: string;
} | null;

export async function resetOfflineAccessAction(
  _state: OfflineAccessResetState,
  form: FormData,
): Promise<OfflineAccessResetState> {
  try {
    const driver = await resetDriverOfflineAccess(form);
    revalidatePath(`/admin/drivers/${driver}`);
    revalidatePath("/admin/sync");
    revalidatePath("/driver", "layout");
    return {
      success:
        "Offline access reset successfully. The driver can reopen the app while online.",
    };
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof OfflineServerError) {
      return {
        error:
          error.code === "MIGRATION_REQUIRED"
            ? "The offline access update must be deployed before reset is available."
            : "Offline access could not be reset. Reload the driver page and try again.",
      };
    }
    return {
      error:
        error instanceof Error
          ? error.message
          : "Offline access could not be reset. Reload the driver page and try again.",
    };
  }
}
