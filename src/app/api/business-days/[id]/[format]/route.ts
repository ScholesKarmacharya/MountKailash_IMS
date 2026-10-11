import { getDayReport } from "@/services/business-days";
import { dailyCsv, dailyDocument } from "@/domain/business-days/reports";
import { receiptPdf } from "@/services/pdf";
import { requirePermission } from "@/services/auth";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; format: string }> },
) {
  await requirePermission("admin:read");
  const { id, format } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id) || !["pdf", "csv"].includes(format))
    return new Response("Report not found", { status: 404 });
  const detail = await getDayReport(id);
  if (!detail)
    return new Response("Report not found", {
      status: 404,
      headers: { "Cache-Control": "private, no-store" },
    });
  const filename = `MK-day-${detail.report.day.date_label}-${id.slice(0, 8)}.${format}`;
  const body =
    format === "pdf"
      ? Buffer.from(await receiptPdf(dailyDocument(detail.report)))
      : dailyCsv(detail.report);
  return new Response(body, {
    headers: {
      "Content-Type":
        format === "pdf" ? "application/pdf" : "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
