import type { ComponentProps } from "react";
import { Input } from "./input";
// UI convenience only: every future stock operation must validate integer bounds on server.
export function NumericInput(
  props: Omit<ComponentProps<"input">, "type" | "min" | "step">,
) {
  return (
    <Input {...props} type="number" inputMode="numeric" min={0} step={1} />
  );
}
