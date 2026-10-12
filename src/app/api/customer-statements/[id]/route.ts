import { tr } from "@/domain/localization/format";
import { requirePermission } from "@/services/auth";
import { getLocale } from "@/lib/i18n/server";
import { readFinance, readStatementLedger } from "@/data-access/finance";
import { readOperations } from "@/data-access/operations";
import { canonicalRange } from "@/domain/localization/calendar";
import {
  statementCsv,
  statementDocument,
} from "@/domain/finance/statement-document";
import { receiptPdf } from "@/services/pdf";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const profile = await requirePermission("admin:read"),
    locale = await getLocale(profile);
  const { id } = await params,
    q = new URL(request.url).searchParams;
  let range;
  try {
    range = canonicalRange(q.get("from") ?? "", q.get("to") ?? "");
  } catch {
    return new Response(tr(locale, "Invalid business-date range"), {
      status: 400,
    });
  }
  if (!["csv", "pdf"].includes(q.get("format") ?? ""))
    return new Response(tr(locale, "Choose PDF or CSV"), { status: 400 });
  const [finance, operations] = await Promise.all([
    readFinance(),
    readOperations(),
  ]);
  const customer = operations.customers.find((c) => c.id === id);
  if (!finance.available || !customer)
    return new Response(tr(locale, "Statement not found"), { status: 404 });
  const statementFinance = {
    ...finance,
    ledger: await readStatementLedger(customer.id, range),
  };
  const pdf = q.get("format") === "pdf";
  const body = pdf
    ? Buffer.from(
        await receiptPdf(
          statementDocument(statementFinance, customer, range, locale),
        ),
      )
    : statementCsv(statementFinance, customer, range, locale);
  return new Response(body, {
    headers: {
      "Content-Type": pdf ? "application/pdf" : "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="MK-credit-${id}.${pdf ? "pdf" : "csv"}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
