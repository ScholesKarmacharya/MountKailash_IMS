import { requirePermission } from "@/services/auth";
import { readFinance } from "@/data-access/finance";
import { receiptPdf } from "@/services/pdf";
import { invoiceDocument } from "@/domain/finance/documents";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  await requirePermission("payment:record");
  const { id } = await params;
  const f = await readFinance(),
    invoice = f.invoices.find((i) => i.id === id);
  if (!invoice)
    return new Response("Invoice not found", {
      status: 404,
      headers: { "Cache-Control": "private, no-store" },
    });
  const bytes = await receiptPdf(invoiceDocument(invoice, f));
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="MK-${invoice.number.padStart(8, "0")}.pdf"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
