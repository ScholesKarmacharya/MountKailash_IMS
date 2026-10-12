import { T, DateValue } from "@/components/localization";
import { randomUUID } from "node:crypto";
import Link from "next/link";
import { getDayHistory, getDayReport } from "@/services/business-days";
import { DayReportView } from "@/components/day-report";
import {
  DayReviewForm,
  DayCloseForm,
  ResumeDayForm,
} from "@/components/day-forms";
import { OpenDayForm } from "@/components/inventory-forms";
import { Card } from "@/components/ui/card";
import { isOvernightDay } from "@/domain/business-days/time";
export default async function DailyClose() {
  const history = await getDayHistory();
  const active = history.days.find((d) => d.status !== "CLOSED");
  const detail = active ? await getDayReport(active.id) : null;
  return (
    <div className="space-y-7">
      <div>
        <h1 className="text-3xl font-bold">
          <T k="Daily closing" />
        </h1>
        <p className="mt-2 text-muted-foreground">
          <T k="Manual review and reconciliation in Nepal business time. Closing never resets stock, credit or deposits." />
        </p>
        <Link
          href="/admin/reports"
          className="mt-3 inline-block text-primary underline"
        >
          <T k="Daily history" />
        </Link>
      </div>
      {!history.available ? (
        <Card>
          <p role="status">
            <T k="Sprint 4 migrations are required before daily closing can load. Review the migration documentation." />
          </p>
        </Card>
      ) : !detail ? (
        <Card>
          <h2 className="mb-4 font-semibold">
            <T k="No active business day" />
          </h2>
          <p className="mb-4 text-sm">
            <T k="Open a day manually. The date uses Asia/Kathmandu; existing balances carry forward." />
          </p>
          <OpenDayForm requestKey={randomUUID()} />
        </Card>
      ) : (
        <>
          {isOvernightDay(detail.report.day.date_label) && (
            <p
              role="status"
              className="rounded-lg bg-amber-50 p-4 text-amber-900"
            >
              <T
                k="This day continues from an earlier calendar date. Its transactions remain attached to {0} until you close it."
                values={[
                  <DateValue key="v0" value={detail.report.day.date_label} />,
                ]}
              />
            </p>
          )}
          <Card>
            <h2 className="mb-4 text-xl font-semibold">
              <T k="Pre-closing checklist" />
            </h2>
            {!detail.blockers.length ? (
              <p role="status" className="mb-4 text-emerald-800">
                <T k="No critical blockers detected. Check the physical stock and collection evidence before confirming." />
              </p>
            ) : (
              <ul className="mb-5 space-y-3">
                {detail.blockers.map((b, i) => (
                  <li
                    key={i}
                    className="rounded-lg bg-red-50 p-3 text-sm text-red-900"
                  >
                    <Link href={b.href} className="underline">
                      {b.message}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {detail.report.day.status === "OPEN" ? (
              <DayReviewForm
                day={detail.report.day}
                requestKey={randomUUID()}
                blocked={detail.blockers.length > 0}
              />
            ) : (
              <p className="text-sm">
                <T k="Closing review is active. Day transactions are frozen; close after checking the report or explicitly resume to resolve an issue." />
              </p>
            )}
          </Card>
          {detail.report.day.status === "CLOSING_REVIEW" && (
            <div className="grid items-start gap-6 xl:grid-cols-2">
              <Card>
                <h2 className="mb-4 text-xl font-semibold">
                  <T k="Confirm daily reconciliation" />
                </h2>
                <DayCloseForm
                  day={detail.report.day}
                  requestKey={randomUUID()}
                  cash={detail.report.totals.cash_net}
                />
              </Card>
              <Card>
                <h2 className="mb-4 text-xl font-semibold">
                  <T k="Resolve a review issue" />
                </h2>
                <ResumeDayForm
                  day={detail.report.day}
                  requestKey={randomUUID()}
                />
              </Card>
            </div>
          )}
          <DayReportView report={detail.report} />
        </>
      )}
    </div>
  );
}
