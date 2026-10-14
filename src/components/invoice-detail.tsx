import { T } from "@/components/localization";
import { randomUUID } from "node:crypto";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getFinance } from "@/services/finance";
import { getOperations } from "@/services/operations";
import { invoiceDocument } from "@/domain/finance/documents";
import { Card } from "./ui/card";
import { FinanceRequired } from "./finance-overview";
import { PrintButton } from "./print-button";
import { OperationForm, Field, Select } from "./operation-form";
import { InvoicePaymentForm } from "./finance-payment";
import { LocalizedDocument } from "./localized-document";
export async function InvoiceDetail({
  id,
  admin,
}: {
  id: string;
  admin: boolean;
}) {
  const [f, w] = await Promise.all([getFinance(admin), getOperations(admin)]);
  if (!f.available) return <FinanceRequired />;
  const i = f.invoices.find((i) => i.id === id);
  if (!i) notFound();
  const document = invoiceDocument(i, f),
    day = w.days.find((d) => d.status === "OPEN");
  const documents = { en: document, ne: invoiceDocument(i, f, "ne") };
  const sale = f.sales.find((s) => s.id === i.sale_id)!,
    trip = w.trips.find((t) => t.id === sale.trip_id);
  return (
    <div className="space-y-6">
      <LocalizedDocument documents={documents} heading />
      <Card>
        <h2 className="text-xl font-bold">{document.company.name}</h2>
        <p>{document.company.address}</p>
        <p>
          {document.company.phone} {document.company.registration}
        </p>
        <LocalizedDocument documents={documents} />
        <div className="mt-6 flex gap-4 print:hidden">
          <PrintButton />
          <Link
            className="text-primary underline"
            href={"/api/invoices/" + i.id + "/pdf"}
          >
            <T k="Download PDF" />
          </Link>
        </div>
      </Card>
      {trip?.status === "ACTIVE" &&
        day?.id === trip.business_day_id &&
        i.available !== "0.00" && (
          <Card className="print:hidden">
            <h2 className="mb-4 font-semibold">
              <T k="Additional invoice receipt" />
            </h2>
            <InvoicePaymentForm
              invoice={i.id}
              customer={sale.customer_id}
              trip={trip.id}
              available={i.available}
              requestKey={randomUUID()}
            />
          </Card>
        )}
      {admin && day && sale.supply_classification !== "FREE_SUPPLY" && (
        <Card className="print:hidden">
          <h2 className="mb-4 font-semibold">
            <T k="Audited correction" />
          </h2>
          <OperationForm
            operation="finance:ADJUST"
            requestKey={randomUUID()}
            label="Post adjustment"
            confirm="Post an immutable credit/debit adjustment? Original invoice items and prices remain preserved. This does not change physical stock or jar custody."
          >
            <input type="hidden" name="invoice" value={i.id} />
            <input type="hidden" name="day" value={day.id} />
            <Select name="direction" label="Adjustment type">
              <option value="CREDIT">
                <T k="Credit - reduce unpaid invoice" />
              </option>
              <option value="DEBIT">
                <T k="Debit - increase invoice" />
              </option>
            </Select>
            <Field
              name="subtotal_amount"
              label="Sales adjustment amount (NPR)"
              required
            />
            <Field
              name="tax_amount"
              label="Confirmed tax adjustment amount (NPR)"
              value="0.00"
              required
            />
            <Field
              name="reason"
              label="Reason for correction"
              required
              maxLength={500}
            />
          </OperationForm>
        </Card>
      )}
    </div>
  );
}
