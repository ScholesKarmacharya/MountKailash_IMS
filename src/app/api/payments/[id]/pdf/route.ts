import { requirePermission } from "@/services/auth";
import { readFinance } from "@/data-access/finance";
import { readOperations } from "@/data-access/operations";
import { receiptPdf } from "@/services/pdf";
import { paymentDocument } from "@/domain/finance/documents";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  await requirePermission("payment:record");
  const { id } = await params;
  const [f, w] = await Promise.all([readFinance(), readOperations()]);
  const p = f.payments.find((p) => p.id === id);
  if (!p)
    return new Response("Receipt not found", {
      status: 404,
      headers: { "Cache-Control": "private, no-store" },
    });
  const bytes = await receiptPdf(
    paymentDocument(
      p,
      f,
      w.days.find((d) => d.id === p.business_day_id)?.date_label ??
        p.business_day_id,
    ),
  );
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="R-${p.number.padStart(8, "0")}.pdf"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
