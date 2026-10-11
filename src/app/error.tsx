"use client";
import { Button } from "@/components/ui/button";
export default function ErrorBoundary({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main id="main-content" className="p-8">
      <h1 className="text-2xl font-bold">Workspace unavailable</h1>
      <p className="my-4">
        We could not load this page. Check your connection and try again.
      </p>
      <Button onClick={reset}>Try again</Button>
    </main>
  );
}
