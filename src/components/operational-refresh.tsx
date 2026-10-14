"use client";
import { T, Message, useLocale } from "@/components/localization";

import { useEffect, useState, useTransition } from "react";
import { Clock3, RefreshCw } from "lucide-react";
import { BUSINESS_TIME_ZONE } from "@/domain/business-days/time";
import { useRouter } from "next/navigation";
import { Button } from "./ui/button";
import { useDriverRuntime } from "./driver-runtime-context";

// Use on read-only workspaces. Delivery drafts refresh explicitly so an
// arriving load or another device's sale cannot erase an unsaved transaction.
export function OperationalRefresh({
  compact = false,
  updatedAt,
}: {
  compact?: boolean;
  updatedAt?: string;
}) {
  const router = useRouter();
  const runtime = useDriverRuntime();
  const { locale, number } = useLocale();
  const [now, setNow] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();
  useEffect(() => {
    if (!updatedAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 10000);
    return () => window.clearInterval(timer);
  }, [updatedAt]);
  useEffect(() => {
    if (runtime) return;
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
  }, [router, runtime]);
  const minutes =
    updatedAt && now
      ? Math.max(0, Math.floor((now - Date.parse(updatedAt)) / 60000))
      : 0;
  return (
    <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
      {compact && updatedAt ? (
        <div
          className="flex min-w-0 items-center gap-2"
          data-testid="overview-refresh"
        >
          <Clock3 className="size-4 shrink-0" aria-hidden="true" />
          <div>
            <p>
              {minutes < 1 ? (
                <T k="Last updated just now" />
              ) : (
                <T k="Last updated {0} min ago" values={[minutes]} />
              )}
            </p>
            <time dateTime={updatedAt} data-testid="overview-updated-at">
              {number(
                new Intl.DateTimeFormat(locale === "ne" ? "ne-NP" : "en-NP", {
                  timeZone: BUSINESS_TIME_ZONE,
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                  hour12: false,
                }).format(new Date(updatedAt)),
              )}
              {" · "}
              <T k="Nepal time" />
            </time>
          </div>
        </div>
      ) : (
        <p>
          <T k="Checks confirmed database updates every 10 seconds and when you return." />
        </p>
      )}
      <Button
        type="button"
        variant="outline"
        disabled={pending}
        onClick={() =>
          startTransition(() => {
            if (runtime) void runtime.refresh();
            else router.refresh();
          })
        }
      >
        {compact && <RefreshCw className="size-4" aria-hidden="true" />}
        <Message value={pending ? "Updating…" : "Refresh"} />
      </Button>
    </div>
  );
}
