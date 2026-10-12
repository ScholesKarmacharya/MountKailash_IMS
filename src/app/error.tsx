"use client";
import { T } from "@/components/localization";

import { Button } from "@/components/ui/button";
export default function ErrorBoundary({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main id="main-content" className="p-8">
      <h1 className="text-2xl font-bold">
        <T k="Workspace unavailable" />
      </h1>
      <p className="my-4">
        <T k="We could not load this page. Check your connection and try again." />
      </p>
      <Button onClick={reset}>
        <T k="Try again" />
      </Button>
    </main>
  );
}
