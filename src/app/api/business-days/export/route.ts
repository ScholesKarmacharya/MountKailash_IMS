import { requirePermission } from "@/services/auth";
import { getDayHistory, getDayReport } from "@/services/business-days";
import { dateFilter } from "@/domain/business-days/commands";
import { dailyCsv, dailyDocument } from "@/domain/business-days/reports";
import { receiptPdf } from "@/services/pdf";
export async function GET(request: Request) {
  await requirePermission("admin:read");
  const params = new URL(request.url).searchParams,
    format = params.get("format");
  let from: string | null, to: string | null;
  try {
    from = dateFilter(params.get("from") ?? undefined);
    to = dateFilter(params.get("to") ?? undefined);
    if (from && to && from > to) throw new Error();
  } catch {
    return new Response("Invalid business-date range", { status: 400 });
  }
  if (format !== "csv" && format !== "pdf")
    return new Response("Choose PDF or CSV", { status: 400 });
  const history = await getDayHistory(from ?? undefined, to ?? undefined);
  if (!history.available)
    return new Response("Closing migration required", { status: 503 });
  if (!history.days.length)
    return new Response("No matching business days", { status: 404 });
  // Read only archived or consistent live reports; no financial or inventory mutation.
  const reports = [];
  for (const day of history.days) {
    const detail = await getDayReport(day.id);
    if (!detail)
      return new Response(
        "A selected report could not be loaded. Please retry.",
        {
          status: 503,
          headers: { "Cache-Control": "private, no-store" },
        },
      );
    reports.push(detail.report);
  }
  const document = reports.map(dailyDocument);
  const body =
    format === "csv"
      ? reports
          .map((r, i) => {
            const csv = dailyCsv(r);
            return i === 0 ? csv : csv.slice(csv.indexOf("\r\n") + 2);
          })
          .join("")
      : Buffer.from(
          await receiptPdf({
            title: `Business-day reports ${from ?? "all"} to ${to ?? "latest"}`,
            company: document[0]!.company,
            lines: document.flatMap((d) => [d.title, ...d.lines, ""]),
          }),
        );
  return new Response(body, {
    headers: {
      "Content-Type":
        format === "pdf" ? "application/pdf" : "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="MK-days-${from ?? "all"}-${to ?? "latest"}.${format}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
