import { randomUUID } from "node:crypto";
import Link from "next/link";
import { getDayHistory, getDayReport } from "@/services/business-days";
import { getInventory } from "@/services/inventory";
import { ProcessingForm } from "@/components/day-forms";
import { Card } from "@/components/ui/card";
export default async function Refilling() {
  const [history, inventory] = await Promise.all([
    getDayHistory(),
    getInventory(),
  ]);
  const day = history.days.find((d) => d.status !== "CLOSED");
  const detail = day ? await getDayReport(day.id) : null;
  return (
    <div className="space-y-7">
      <div>
        <h1 className="text-3xl font-bold">Refilling and damaged jars</h1>
        <p className="mt-2 text-muted-foreground">
          Record completed refills and inspection rejections as distinct,
          audited stock workflows.
        </p>
      </div>
      {!history.available ? (
        <Card>
          <p role="status">
            Sprint 4 migrations are required before processing can load.
          </p>
        </Card>
      ) : day?.status !== "OPEN" ? (
        <Card>
          <p>
            An OPEN business day is required.{" "}
            <Link className="text-primary underline" href="/admin/daily-close">
              Review business day
            </Link>
          </p>
        </Card>
      ) : (
        <div className="grid items-start gap-6 xl:grid-cols-2">
          {(["REFILL", "DAMAGE"] as const).map((operation) => (
            <Card key={operation}>
              <h2 className="mb-4 text-xl font-semibold">
                {operation === "REFILL"
                  ? "Completed refill batch"
                  : "Damaged jar inspection"}
              </h2>
              <ProcessingForm
                day={day.id}
                products={inventory.products}
                operation={operation}
                requestKey={randomUUID()}
              />
            </Card>
          ))}
        </div>
      )}
      {detail && (
        <Card>
          <h2 className="mb-4 text-xl font-semibold">
            Current-day processing history
          </h2>
          {!detail.report.processing.length ? (
            <p>No processing recorded for this day.</p>
          ) : (
            detail.report.processing.map((p) => (
              <p key={p.id} className="border-b border-border py-3 text-sm">
                {p.operation} · {p.quantity} · {p.product_name} · {p.actor_name}{" "}
                · {p.reason}
              </p>
            ))
          )}
          <Link
            className="mt-4 inline-block text-primary underline"
            href={`/admin/reports/${day!.id}`}
          >
            View stock and audit report
          </Link>
        </Card>
      )}
    </div>
  );
}
