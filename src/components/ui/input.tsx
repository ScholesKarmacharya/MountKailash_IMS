"use client";
import * as React from "react";
import { cn } from "@/lib/utils";
import { useLocale } from "../localization";
import { latinDigits } from "@/domain/localization/locale";
export function Input({
  className,
  type,
  ...props
}: React.ComponentProps<"input">) {
  const { t } = useLocale();
  return (
    <input
      type={type}
      className={cn(
        "flex min-h-11 w-full rounded-lg border border-input bg-background px-3 py-2 text-base focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50",
        className,
      )}
      {...props}
      placeholder={props.placeholder ? t(props.placeholder) : undefined}
      aria-label={props["aria-label"] ? t(props["aria-label"]) : undefined}
      onChange={(event) => {
        event.target.setCustomValidity("");
        if (props.inputMode === "numeric" || props.inputMode === "decimal") {
          event.target.value = latinDigits(event.target.value);
        }
        props.onChange?.(event);
      }}
      onInvalid={(event) => {
        const input = event.currentTarget;
        input.setCustomValidity(
          t(
            input.validity.valueMissing
              ? "This field is required."
              : "Enter a valid value within the allowed range.",
          ),
        );
        props.onInvalid?.(event);
      }}
    />
  );
}
