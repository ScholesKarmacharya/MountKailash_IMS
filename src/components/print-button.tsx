"use client";
import { Button } from "./ui/button";
export function PrintButton() {
  return (
    <Button type="button" variant="outline" onClick={() => window.print()}>
      Print receipt
    </Button>
  );
}
