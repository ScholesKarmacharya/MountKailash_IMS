"use client";
import { useActionState, useEffect, useState, useId } from "react";
import Link from "next/link";
import { operationAction } from "@/app/operations-actions";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
export function Field({
  label,
  name,
  value = "",
  required = false,
  maxLength = 2000,
}: {
  label: string;
  name: string;
  value?: string;
  required?: boolean;
  maxLength?: number;
}) {
  return (
    <label className="grid gap-2 text-sm font-medium">
      {label}
      <Input
        name={name}
        defaultValue={value}
        required={required}
        maxLength={maxLength}
      />
    </label>
  );
}
export function Select({
  label,
  name,
  children,
  value,
  required = true,
}: {
  label: string;
  name: string;
  children: React.ReactNode;
  value?: string;
  required?: boolean;
}) {
  const id = useId();
  return (
    <div className="grid gap-2 text-sm font-medium">
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        name={name}
        defaultValue={value}
        required={required}
        className="min-h-12 w-full rounded-lg border border-input bg-background px-3"
      >
        {children}
      </select>
    </div>
  );
}
export function OperationForm({
  operation,
  requestKey,
  children,
  label = "Save",
  trip,
  id,
  version = 0,
  confirm = "Save these details to the database?",
  resultHref,
  showSubmit = true,
}: {
  operation: string;
  requestKey: string;
  children?: React.ReactNode;
  label?: string;
  trip?: string;
  id?: string;
  version?: number;
  confirm?: string;
  resultHref?: string;
  showSubmit?: boolean;
}) {
  const [state, action, pending] = useActionState(
    async (previous: Parameters<typeof operationAction>[0], form: FormData) => {
      window.dispatchEvent(new Event("operation-saving"));
      try {
        const result = await operationAction(previous, form);
        if (result?.success) window.dispatchEvent(new Event("operation-saved"));
        return result;
      } finally {
        window.dispatchEvent(new Event("operation-settled"));
      }
    },
    null,
  );
  const [dirty, setDirty] = useState(false);
  // Preserve the exact request and expected version while an unsaved form is mounted.
  const [stableRequest] = useState(requestKey);
  const [stableId] = useState(id);
  const [stableVersion] = useState(version);
  useEffect(() => {
    if (!dirty || state?.success) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, state?.success]);
  return (
    <form
      action={action}
      className="space-y-5"
      onChange={() => setDirty(true)}
      onClick={() => setDirty(true)}
      onSubmit={(e) => {
        if (!showSubmit || !window.confirm(confirm)) e.preventDefault();
      }}
    >
      <input type="hidden" name="operation" value={operation} />
      <input type="hidden" name="key" value={stableRequest} />
      {trip && <input type="hidden" name="trip" value={trip} />}
      {stableId && <input type="hidden" name="id" value={stableId} />}
      <input type="hidden" name="version" value={stableVersion} />
      <fieldset disabled={pending || !!state?.success} className="space-y-5">
        {children}
        {showSubmit && (
          <Button
            type="submit"
            className="min-h-12 w-full sm:w-auto"
            disabled={pending}
          >
            {pending ? "Saving…" : label}
          </Button>
        )}
      </fieldset>
      {state?.error && (
        <p
          role="alert"
          className="rounded-lg bg-red-50 p-4 text-sm text-red-800"
        >
          {state.error}
        </p>
      )}
      {state?.success && (
        <div
          role="status"
          className="space-y-3 rounded-lg bg-teal-50 p-4 text-sm text-teal-900"
        >
          <p>Record saved.</p>
          {resultHref && state.id ? (
            <Link
              className="font-semibold underline"
              href={`${resultHref}/${state.id}`}
            >
              Open saved trip
            </Link>
          ) : (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                window.location.reload();
              }}
            >
              Continue with updated data
            </Button>
          )}
        </div>
      )}
    </form>
  );
}
export function Counter({
  label,
  value,
  onChange,
  max = 1000000000,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  max?: number;
}) {
  return (
    <label className="grid gap-2 text-sm font-semibold">
      {label}
      <div className="grid grid-cols-[52px_1fr_52px] gap-2">
        <Button
          type="button"
          variant="outline"
          className="h-14 text-xl"
          disabled={value <= 0}
          aria-label={`Decrease ${label}`}
          onClick={() => onChange(Math.max(0, value - 1))}
        >
          −
        </Button>
        <Input
          type="number"
          inputMode="numeric"
          min={0}
          max={max}
          step={1}
          required
          value={value}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isInteger(n) && n >= 0 && n <= 1000000000) onChange(n);
          }}
          className="h-14 text-center text-xl"
          aria-label={label}
        />
        <Button
          type="button"
          variant="outline"
          className="h-14 text-xl"
          disabled={value >= max}
          aria-label={`Increase ${label}`}
          onClick={() => onChange(Math.min(max, value + 1))}
        >
          +
        </Button>
      </div>
    </label>
  );
}
