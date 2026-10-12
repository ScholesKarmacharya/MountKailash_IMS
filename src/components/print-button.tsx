"use client";
import { T } from "@/components/localization";

import { Button } from "./ui/button";
export function PrintButton() {
  return (
    <Button type="button" variant="outline" onClick={() => window.print()}>
      <T k="Print receipt" />
    </Button>
  );
}
