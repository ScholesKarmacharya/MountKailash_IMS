import { requirePermission } from "@/services/auth";
import { readFinance } from "@/data-access/finance";
import { readOperations } from "@/data-access/operations";
import { receiptPdf } from "@/services/pdf";
import { npr } from "@/domain/finance/money";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  await requirePermission("finance:manage");
  const { id } = await params;
  const [f, w] = await Promise.all([readFinance(), readOperations()]);
  const d = f.deposits.find((d) => d.id === id);
  if (!d || !f.company)
    return new Response("Deposit transaction not found", {
      status: 404,
      headers: { "Cache-Control": "private, no-store" },
    });
  const bytes = await receiptPdf({
    title: "Deposit " + d.kind,
    company: f.company,
    lines: [
      `Deposit transaction: ${d.id}`,
      `Customer: ${w.customers.find((c) => c.id === d.customer_id)?.name ?? d.customer_id}`,
      `Business day: ${w.days.find((day) => day.id === d.business_day_id)?.date_label ?? d.business_day_id}`,
      `${d.kind}: ${npr(d.amount)}`,
      d.reason,
      "Refundable deposit liability transaction; separate from water sales and customer credit.",
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
