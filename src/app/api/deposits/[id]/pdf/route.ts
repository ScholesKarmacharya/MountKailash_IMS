import { getLocale } from "@/lib/i18n/server";
import { requirePermission } from "@/services/auth";
import { readFinance } from "@/data-access/finance";
import { readOperations } from "@/data-access/operations";
import { receiptPdf } from "@/services/pdf";
import { readBusinessDate } from "@/data-access/business-days";
import { formatBusinessDate } from "@/domain/localization/calendar";
import { tr, money } from "@/domain/localization/format";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const profile = await requirePermission("finance:manage");
  const locale = await getLocale(profile);
  const { id } = await params;
  const [f, w] = await Promise.all([readFinance(), readOperations()]);
  const d = f.deposits.find((d) => d.id === id);
  if (!d || !f.company)
    return new Response(tr(locale, "Deposit transaction not found"), {
      status: 404,
      headers: { "Cache-Control": "private, no-store" },
    });
  const bytes = await receiptPdf({
    title: tr(locale, "Deposit {0}", [tr(locale, d.kind)]),
    company: f.company,
    lines: [
      tr(locale, "Deposit transaction: {0}", [d.id]),
      tr(locale, "Customer: {0}", [
        w.customers.find((c) => c.id === d.customer_id)?.name ?? d.customer_id,
      ]),
      tr(locale, "Business date: {0}", [
        formatBusinessDate(await readBusinessDate(d.business_day_id), locale),
      ]),
      tr(locale, "Payment date: {0}", [
        formatBusinessDate(d.created_at, locale, true),
      ]),
      `${tr(locale, d.kind)}: ${money(d.amount, locale)}`,
      d.reason,
      tr(
        locale,
        "Refundable deposit liability transaction; separate from water sales and customer credit.",
      ),
    ],
  });
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="deposit-${id}.pdf"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
