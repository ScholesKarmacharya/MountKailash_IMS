import Link from "next/link";
import { getDayHistory } from "@/services/business-days";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { npr, sum } from "@/domain/finance/money";
import { dateFilter } from "@/domain/business-days/commands";
export default async function History({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const params = await searchParams;
  let error: string | null = null,
    from: string | null = null,
    to: string | null = null;
  try {
    from = dateFilter(params.from);
    to = dateFilter(params.to);
    if (from && to && from > to)
      throw new Error("Start date must precede end date.");
  } catch (e) {
    error = e instanceof Error ? e.message : "Invalid dates.";
  }
  const history = await getDayHistory(
    error ? undefined : (from ?? undefined),
    error ? undefined : (to ?? undefined),
  );
  const query = new URLSearchParams();
  if (from) query.set("from", from);
  if (to) query.set("to", to);
  return (
    <div className="space-y-7">
      <div>
        <h1 className="text-3xl font-bold">Daily history</h1>
        <p className="mt-2 text-muted-foreground">
          Archived closings and current sessions. Filter by Nepal business-date
          labels, including days that crossed midnight.
        </p>
      </div>
      <Card>
        <form className="flex flex-wrap items-end gap-4">
          <label className="grid gap-2 text-sm font-medium">
            From date
            <Input name="from" type="date" defaultValue={from ?? ""} />
          </label>
          <label className="grid gap-2 text-sm font-medium">
            To date
            <Input name="to" type="date" defaultValue={to ?? ""} />
          </label>
          <Button type="submit">Filter history</Button>
          <Link className="text-primary underline" href="/admin/reports">
            Clear filters
          </Link>
        </form>
        {error && (
          <p role="alert" className="mt-4 text-red-800">
            {error}
          </p>
        )}
      </Card>
      {!history.available ? (
        <Card>
          <p role="status">
            Sprint 4 migrations are required before historical reports can load.
          </p>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            {[
              [
                "Selected-day sales",
                sum(history.days.map((d) => d.totals.sales)),
              ],
              [
                "Confirmed collections",
                sum(history.days.map((d) => d.totals.collections)),
              ],
              [
                "Previous-day credit recovered",
                sum(history.days.map((d) => d.totals.old_credit_recovered)),
              ],
            ].map(([label, value]) => (
              <Card key={label}>
                <h2 className="text-sm text-muted-foreground">{label}</h2>
                <p className="mt-3 text-xl font-bold">{npr(value!)}</p>
              </Card>
            ))}
          </div>
          {!error && history.days.length > 0 && (
            <div className="flex flex-wrap gap-4">
              <Link
                className="text-primary underline"
                href={`/api/business-days/export?${query}&format=csv`}
              >
                Export selected days to Excel-compatible CSV
              </Link>
              <Link
                className="text-primary underline"
                href={`/api/business-days/export?${query}&format=pdf`}
              >
                Export selected days to PDF
              </Link>
            </div>
          )}
          <Card>
            {!history.days.length ? (
              <p>No business days match this date range.</p>
            ) : (
              <ul className="divide-y divide-border">
                {history.days.map((d) => (
                  <li
                    key={d.id}
                    className="flex flex-wrap items-center justify-between gap-4 py-5"
                  >
                    <div>
                      <Link
                        href={`/admin/reports/${d.id}`}
                        className="text-lg font-semibold text-primary underline"
                      >
                        {d.date_label}
                      </Link>
                      <p className="mt-1 text-sm">
                        {d.status.replaceAll("_", " ")} · {d.totals.trips} trips
                        ·{" "}
                        {d.archived
                          ? "Closing archive v1"
                          : d.status === "CLOSED"
                            ? "Legacy reconstructed report"
                            : "Live preview"}
                      </p>
                      <p className="mt-1 text-sm">
                        Sales {npr(d.totals.sales)} · collections{" "}
                        {npr(d.totals.collections)} · prior-credit recovery{" "}
                        {npr(d.totals.old_credit_recovered)}
                      </p>
                      {d.closed_by_name && (
                        <p className="mt-1 text-sm text-muted-foreground">
                          Closed by {d.closed_by_name}
                        </p>
                      )}
                    </div>
                    <Link
                      className="text-primary underline"
                      href={`/admin/reports/${d.id}`}
                    >
                      View daily report
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Link href="/admin/daily-close" className="text-primary underline">
            Review current business day
          </Link>
        </>
      )}
    </div>
  );
}
