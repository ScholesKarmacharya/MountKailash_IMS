import { requirePermission } from "@/services/auth";
import { getLocale } from "@/lib/i18n/server";
import { getHouseWorkspace } from "@/services/house";
import { getFinance } from "@/services/finance";
import { houseFilter } from "@/domain/house/pricing";
import { freeDocument, freeExportRows } from "@/domain/house/export";
import { receiptPdf } from "@/services/pdf";
import { excelWorkbook } from "@/services/xlsx";
export async function GET(request: Request) {
  const profile = await requirePermission("admin:read"),
    locale = await getLocale(profile);
  const params = Object.fromEntries(new URL(request.url).searchParams);
  let filter;
  try {
    filter = houseFilter(params);
  } catch {
    return new Response("Invalid business-date range.", { status: 400 });
  }
  if (!["pdf", "xlsx"].includes(params.format ?? ""))
    return new Response("Choose PDF or Excel.", { status: 400 });
  const [w, f] = await Promise.all([
    getHouseWorkspace(params),
    getFinance(true),
  ]);
  if (!w.available || !f.company)
    return new Response("HOUSE and finance migrations required.", {
      status: 503,
    });
  const body =
    params.format === "pdf"
      ? Buffer.from(
          await receiptPdf(
            freeDocument(w, f.company, locale, filter.from, filter.to),
          ),
        )
      : excelWorkbook(freeExportRows(w, locale));
  return new Response(body, {
    headers: {
      "Content-Type":
        params.format === "pdf"
          ? "application/pdf"
          : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="MK-free-supply-${filter.from}-${filter.to}.${params.format}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
