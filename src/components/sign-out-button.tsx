"use client";
import { useActionState } from "react";
import { signOut } from "@/app/sign-in/actions";
import { Button } from "./ui/button";
import { Message } from "./localization";
import { unstable_rethrow } from "next/navigation";
import { offlinePending, lockOfflineUser } from "@/lib/offline/store";
import { useLocale } from "./localization";
import { clearDriverSessionCookies } from "@/lib/offline/sign-out";
export function SignOutButton({
  user,
  driver = false,
}: {
  user?: string;
  driver?: boolean;
}) {
  const { t } = useLocale();
  const [state, action, pending] = useActionState(async () => {
    try {
      if (
        (await offlinePending(user)) &&
        !window.confirm(
          t(
            "Unsynced records remain on this device. Export a backup and sync before changing devices. Sign out anyway?",
          ),
        )
      )
        return undefined;
      await lockOfflineUser();
    } catch {
      return {
        error:
          "Device records could not be checked. Sign out was cancelled to protect pending records.",
      };
    }
    // Pause periodic workspace refreshes while logout changes the session.
    window.dispatchEvent(new Event("operation-saving"));
    try {
      const result = await signOut();
      window.dispatchEvent(new Event("operation-settled"));
      return result;
    } catch (error) {
      unstable_rethrow(error);
      window.dispatchEvent(new Event("operation-settled"));
      if (driver) {
        // Local sign-out must work even when the server cannot be contacted.
        // lockOfflineUser has already preserved the journal and required a
        // fresh online sign-in. Never clear an admin's session by this path.
        clearDriverSessionCookies();
        // A document navigation clears mounted session data and lets the
        // service worker reopen its public shell without an offline RSC request.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.assign("/sign-in?reauth=1");
        return undefined;
      }
      return { error: "Could not sign out. Please try again." };
    }
  }, undefined);
  return (
    <form action={action} className="print:hidden">
      <Button
        variant="outline"
        type="submit"
        disabled={pending}
        className="whitespace-nowrap"
      >
        <Message value={pending ? "Signing out…" : "Sign Out"} />
      </Button>
      {state?.error && (
        <p role="alert" className="mt-2 max-w-48 text-xs text-red-800">
          <Message value={state.error} />
        </p>
      )}
    </form>
  );
}
