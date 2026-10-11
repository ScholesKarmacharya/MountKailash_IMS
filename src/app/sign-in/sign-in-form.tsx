"use client";
import { useActionState } from "react";
import { signIn } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
export function SignInForm({ configured }: { configured: boolean }) {
  const [state, action, pending] = useActionState(signIn, null);
  return (
    <form action={action} className="space-y-5" aria-busy={pending}>
      <div className="space-y-2">
        <label htmlFor="email" className="text-sm font-semibold">
          Email address
        </label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          maxLength={254}
          required
          disabled={!configured}
        />
      </div>
      <div className="space-y-2">
        <label htmlFor="password" className="text-sm font-semibold">
          Password
        </label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          maxLength={256}
          required
          disabled={!configured}
        />
      </div>
      {state?.error && (
        <p
          role="alert"
          className="rounded-lg bg-red-50 p-3 text-sm text-red-800"
        >
          {state.error}
        </p>
      )}
      <Button
        className="w-full"
        type="submit"
        disabled={!configured || pending}
      >
        {pending ? "Signing in…" : "Sign in"}
      </Button>
      <p className="text-center text-xs text-muted-foreground">
        Accounts are provisioned by your administrator.
      </p>
    </form>
  );
}
