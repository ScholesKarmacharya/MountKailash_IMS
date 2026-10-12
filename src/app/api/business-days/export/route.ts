import { getLocale } from "@/lib/i18n/server";
import { tr } from "@/domain/localization/format";
import { formatBusinessDate } from "@/domain/localization/calendar";
import { requirePermission } from "@/services/auth";
import { getDayHistory, getDayReport } from "@/services/business-days";
import { dateFilter } from "@/domain/business-days/commands";
import { dailyCsv, dailyDocument } from "@/domain/business-days/reports";
import { receiptPdf } from "@/services/pdf";
export async function GET(request: Request) {
  const profile = await requirePermission("admin:read");
  const locale = await getLocale(profile);
  const params = new URL(request.url).searchParams,
    format = params.get("format");
  let from: string | null, to: string | null;
  try {
    from = dateFilter(params.get("from") ?? undefined);
    to = dateFilter(params.get("to") ?? undefined);
    if (from && to && from > to) throw new Error();
  } catch {
    return new Response(tr(locale, "Invalid business-date range"), {
      status: 400,
    });
  }
  if (format !== "csv" && format !== "pdf")
    return new Response(tr(locale, "Choose PDF or CSV"), { status: 400 });
  const history = await getDayHistory(from ?? undefined, to ?? undefined);
  if (!history.available)
    return new Response(tr(locale, "Closing migration required"), {
      status: 503,
    });
  if (!history.days.length)
    return new Response(tr(locale, "No matching business days"), {
      status: 404,
    });
  // Read only archived or consistent live reports; no financial or inventory mutation.
  const reports = [];
  for (const day of history.days) {
    const detail = await getDayReport(day.id);
    if (!detail)
      return new Response(
        tr(locale, "A selected report could not be loaded. Please retry."),
        {
          status: 503,
          headers: { "Cache-Control": "private, no-store" },
        },
      );
    reports.push(detail.report);
  }
  const document = reports.map((r) => dailyDocument(r, locale));
  const body =
    format === "csv"
      ? reports
          .map((r, i) => {
            const csv = dailyCsv(r, locale);
            return i === 0 ? csv : csv.slice(csv.indexOf("\r\n") + 2);
          })
          .join("")
      : Buffer.from(
          await receiptPdf({
            title: tr(locale, "Business-day reports {0} to {1}", [
              from ? formatBusinessDate(from, locale) : tr(locale, "all"),
              to ? formatBusinessDate(to, locale) : tr(locale, "latest"),
            ]),
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
