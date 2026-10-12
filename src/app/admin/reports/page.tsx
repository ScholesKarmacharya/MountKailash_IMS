import { BsDateRange } from "@/components/bs-date-picker";
import { T, Message, DateValue, Value } from "@/components/localization";
import Link from "next/link";
import { getDayHistory } from "@/services/business-days";
import { Card } from "@/components/ui/card";

import { Button } from "@/components/ui/button";
import { npr, sum } from "@/domain/finance/money";
import { dateFilter } from "@/domain/business-days/commands";
import { getPendingJars } from "@/services/pending-jars";
import { PendingJars } from "@/components/pending-jars";
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
  const pending = await getPendingJars(true);
  if (from) query.set("from", from);
  if (to) query.set("to", to);
  return (
    <div className="space-y-7">
      <div>
        <h1 className="text-3xl font-bold">
          <T k="Daily history" />
        </h1>
        <p className="mt-2 text-muted-foreground">
          <T k="Archived closings and current sessions. Filter by Nepal business-date labels, including days that crossed midnight." />
        </p>
      </div>
      <Card>
        <p className="text-sm">
          <T k="Date filters apply to archived business-day reports below. Current pending jars are shown separately." />
        </p>
        <form className="flex flex-wrap items-end gap-4">
          <BsDateRange from={from ?? ""} to={to ?? ""} />
          <Button type="submit">
            <T k="Filter history" />
          </Button>
          <Link className="text-primary underline" href="/admin/reports">
            <T k="Clear filters" />
          </Link>
        </form>
        {error && (
          <p role="alert" className="mt-4 text-red-800">
            <Message value={error} />
          </p>
        )}
      </Card>
      {!history.available ? (
        <>
          <PendingJars
            workspace={pending}
            admin
            title="Current pending jars (carry-forward)"
          />
          <Card>
            <p role="status">
              <T k="Sprint 4 migrations are required before historical reports can load." />
            </p>
          </Card>
        </>
      ) : (
        <>
          <PendingJars
            workspace={pending}
            admin
            title="Current pending jars (carry-forward)"
          />
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
                <h2 className="text-sm text-muted-foreground">
                  <Message value={label} />
                </h2>
                <p className="mt-3 text-xl font-bold">
                  <Value value={npr(value!)} />
                </p>
              </Card>
            ))}
          </div>
          {!error && history.days.length > 0 && (
            <div className="flex flex-wrap gap-4">
              <Link
                className="text-primary underline"
                href={`/api/business-days/export?${query}&format=csv`}
              >
                <T k="Export selected days to Excel-compatible CSV" />
              </Link>
              <Link
                className="text-primary underline"
                href={`/api/business-days/export?${query}&format=pdf`}
              >
                <T k="Export selected days to PDF" />
              </Link>
            </div>
          )}
          <Card>
            {!history.days.length ? (
              <p>
                <T k="No business days match this date range." />
              </p>
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
                        <DateValue value={d.date_label} />
                      </Link>
                      <p className="mt-1 text-sm">
                        <T
                          k="{0} · {1} trips · {2}"
                          values={[
                            <Message
                              key="v0"
                              value={d.status.replaceAll("_", " ")}
                            />,
                            <Value key="v1" value={d.totals.trips} />,
                            <Message
                              key="v2"
                              value={
                                d.archived
                                  ? "Closing archive v1"
                                  : d.status === "CLOSED"
                                    ? "Legacy reconstructed report"
                                    : "Live preview"
                              }
                            />,
                          ]}
                        />
                      </p>
                      <p className="mt-1 text-sm">
                        <T
                          k="Sales {0} · collections {1} · prior-credit recovery {2}"
                          values={[
                            <Value key="v0" value={npr(d.totals.sales)} />,
                            <Value
                              key="v1"
                              value={npr(d.totals.collections)}
                            />,
                            <Value
                              key="v2"
                              value={npr(d.totals.old_credit_recovered)}
                            />,
                          ]}
                        />
                      </p>
                      {d.closed_by_name && (
                        <p className="mt-1 text-sm text-muted-foreground">
                          <T k="Closed by {0}" values={[d.closed_by_name]} />
                        </p>
                      )}
                    </div>
                    <Link
                      className="text-primary underline"
                      href={`/admin/reports/${d.id}`}
                    >
                      <T k="View daily report" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Link href="/admin/daily-close" className="text-primary underline">
            <T k="Review current business day" />
          </Link>
        </>
      )}
    </div>
  );
}
