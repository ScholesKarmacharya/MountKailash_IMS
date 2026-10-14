import { Message } from "../localization";
import { cn } from "@/lib/utils";
export function StatusBadge({
  label,
  tone = "neutral",
}: {
  label: string;
  tone?: "positive" | "warning" | "neutral";
}) {
  return (
    <span
      className={cn(
        "inline-flex rounded-full px-2.5 py-1 text-xs font-semibold",
        tone === "positive"
          ? "bg-teal-50 text-teal-800"
          : tone === "warning"
            ? "bg-amber-50 text-amber-900"
            : "bg-muted text-muted-foreground",
      )}
    >
      <Message value={label} />
    </span>
  );
}
