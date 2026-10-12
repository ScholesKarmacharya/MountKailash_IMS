import { T } from "@/components/localization";
export default function Loading() {
  return (
    <div role="status" className="p-8">
      <p className="animate-pulse">
        <T k="Loading workspace…" />
      </p>
    </div>
  );
}
