"use client";
import { useActionState } from "react";
import { signOut } from "@/app/sign-in/actions";
import { Button } from "./ui/button";
import { Message } from "./localization";
import { unstable_rethrow } from "next/navigation";
export function SignOutButton() {
  const [state, action, pending] = useActionState(async () => {
    // Pause periodic workspace refreshes while logout changes the session.
    window.dispatchEvent(new Event("operation-saving"));
    try {
      const result = await signOut();
      window.dispatchEvent(new Event("operation-settled"));
      return result;
    } catch (error) {
      unstable_rethrow(error);
      window.dispatchEvent(new Event("operation-settled"));
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
