import { T, Value } from "@/components/localization";
import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDayReport } from "@/services/business-days";
import { getInventory } from "@/services/inventory";
import { DayReportView } from "@/components/day-report";
import { ClosedStockCorrection } from "@/components/day-forms";
import { Card } from "@/components/ui/card";
export default async function DayHistoryDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const detail = await getDayReport(id);
  if (!detail) notFound();
  const inventory =
    detail.report.day.status === "CLOSED" ? await getInventory() : null;
  return (
    <div className="space-y-7">
      <div>
        <h1 className="text-3xl font-bold">
          <T k="Business-day report" />
        </h1>
        <Link
          className="mt-3 inline-block text-primary underline"
          href="/admin/reports"
        >
          <T k="Back to daily history" />
        </Link>
      </div>
      <DayReportView report={detail.report} />
      <Card>
        <h2 className="mb-4 text-xl font-semibold">
          <T
            k="Subsequent amendments ({0})"
            values={[<Value key="v0" value={detail.amendments.length} />]}
          />
        </h2>
        <p className="mb-4 text-sm text-muted-foreground">
          <T
            k="Each correction posts on its own open business day. The original version 1 report and exports stay unchanged. Amendment version: {0}."
            values={[<Value key="v0" value={1 + detail.amendments.length} />]}
          />
        </p>
        {!detail.amendments.length ? (
          <p>
            <T k="No linked corrections." />
          </p>
        ) : (
          detail.amendments.map((a) => (
            <div key={a.id} className="border-t border-border py-3 text-sm">
              <p className="font-semibold">
                {a.source_kind.replaceAll("_", " ")} · {a.actor_name} ·{" "}
                {a.posting_date}
              </p>
              <p className="mt-1 break-words">{a.reason}</p>
              <Link
                className="text-primary underline"
                href={`/admin/reports/${a.posting_day_id}`}
              >
                <T k="View posting-day report" />
              </Link>
            </div>
          ))
        )}
        {inventory?.businessDay?.status === "OPEN" && (
          <details className="mt-5">
            <summary className="cursor-pointer font-semibold">
              <T k="Post a linked warehouse stock correction" />
            </summary>
            <div className="mt-4">
              <ClosedStockCorrection
                original={id}
                posting={inventory.businessDay.id}
                products={inventory.products}
                requestKey={randomUUID()}
              />
            </div>
          </details>
        )}
        {detail.report.day.status === "CLOSED" && (
          <p className="mt-4 text-sm">
            {" "}
            <T k="Invoice corrections and receipt reversals made in" />{" "}
            <Link className="text-primary underline" href="/admin/payments">
              <T k="Payments" />
            </Link>{" "}
            <T k="are linked automatically. Open a new business day before posting a correction." />{" "}
          </p>
        )}
      </Card>
    </div>
  );
}
