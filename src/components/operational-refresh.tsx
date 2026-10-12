"use client";
import { T, Message } from "@/components/localization";

import { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "./ui/button";

// Use on read-only workspaces. Delivery drafts refresh explicitly so an
// arriving load or another device's sale cannot erase an unsaved transaction.
export function OperationalRefresh() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  useEffect(() => {
    let saving = false;
    const refresh = () => {
      if (!saving && document.visibilityState === "visible")
        startTransition(() => router.refresh());
    };
    const begin = () => {
      saving = true;
    };
    const end = () => {
      saving = false;
      refresh();
    };
    const timer = window.setInterval(refresh, 10000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("operation-saving", begin);
    window.addEventListener("operation-settled", end);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("operation-saving", begin);
      window.removeEventListener("operation-settled", end);
    };
  }, [router]);
  return (
    <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
      <p>
        <T k="Checks confirmed database updates every 10 seconds and when you return." />
      </p>
      <Button
        type="button"
        variant="outline"
        disabled={pending}
        onClick={() => startTransition(() => router.refresh())}
      >
        <Message value={pending ? "Updating…" : "Refresh"} />
      </Button>
    </div>
  );
}
