import { BsDateRange } from "@/components/bs-date-picker";
import { Button } from "@/components/ui/button";
import { T, Message, Value, DateValue } from "@/components/localization";
import { randomUUID } from "node:crypto";
import Link from "next/link";
import { getDayHistory, getDayReport } from "@/services/business-days";
import { getInventory } from "@/services/inventory";
import { ProcessingForm } from "@/components/day-forms";
import { Card } from "@/components/ui/card";
export default async function Refilling({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const q = await searchParams;
  const [history, inventory] = await Promise.all([
    getDayHistory(),
    getInventory(),
  ]);
  const day = history.days.find((d) => d.status !== "CLOSED");
  const detail = day ? await getDayReport(day.id) : null;
  const filtered = q.from || q.to ? await getDayHistory(q.from, q.to) : null;
  const reports = filtered
    ? await Promise.all(filtered.days.map((d) => getDayReport(d.id)))
    : [detail];
  const processing = reports.flatMap((d) => d?.report.processing ?? []);
  return (
    <div className="space-y-7">
      <div>
        <h1 className="text-3xl font-bold">
          <T k="Refilling and damaged jars" />
        </h1>
        <p className="mt-2 text-muted-foreground">
          <T k="Record completed refills and inspection rejections as distinct, audited stock workflows." />
        </p>
      </div>
      {!history.available ? (
        <Card>
          <p role="status">
            <T k="Sprint 4 migrations are required before processing can load." />
          </p>
        </Card>
      ) : day?.status !== "OPEN" ? (
        <Card>
          <p>
            {" "}
            <T k="An OPEN business day is required." />{" "}
            <Link className="text-primary underline" href="/admin/daily-close">
              <T k="Review business day" />
            </Link>
          </p>
        </Card>
      ) : (
        <div className="grid items-start gap-6 xl:grid-cols-2">
          {(["REFILL", "DAMAGE"] as const).map((operation) => (
            <Card key={operation}>
              <h2 className="mb-4 text-xl font-semibold">
                <Message
                  value={
                    operation === "REFILL"
                      ? "Completed refill batch"
                      : "Damaged jar inspection"
                  }
                />
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
      <form className="space-y-3">
        <BsDateRange from={q.from} to={q.to} />
        <Button type="submit">
          <T k="Filter history" />
        </Button>
      </form>
      {(detail || filtered) && (
        <Card>
          <h2 className="mb-4 text-xl font-semibold">
            <T k="Processing history" />
          </h2>
          {!processing.length ? (
            <p>
              <T k="No processing matches these dates." />
            </p>
          ) : (
            processing.map((p) => (
              <p key={p.id} className="border-b border-border py-3 text-sm">
                <Message value={p.operation} /> · <Value value={p.quantity} /> ·{" "}
                {p.product_name} · {p.actor_name} · {p.reason} ·{" "}
                <DateValue value={p.created_at} time />
              </p>
            ))
          )}
          {day && (
            <Link
              className="mt-4 inline-block text-primary underline"
              href={`/admin/reports/${day!.id}`}
            >
              <T k="View stock and audit report" />
            </Link>
          )}
        </Card>
      )}
    </div>
  );
}
