import { CircleDashed } from "lucide-react";
export function EmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col items-center gap-3 py-8 text-center">
      <CircleDashed
        className="size-9 text-muted-foreground"
        aria-hidden="true"
      />
      <h2 className="font-semibold">{title}</h2>
      <p className="max-w-md text-sm text-muted-foreground">{description}</p>
    </div>
  );
}
