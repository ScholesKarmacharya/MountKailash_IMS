import Link from "next/link";
import { randomUUID } from "node:crypto";
import { getInstantHistory } from "@/services/instant";
import { InstantHistoryView } from "@/components/instant-delivery";
import { T } from "@/components/localization";
import { Card } from "@/components/ui/card";
import { OperationForm, Field } from "@/components/operation-form";
import { OperationalRefresh } from "@/components/operational-refresh";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params,
    history = await getInstantHistory(id, true);
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">
        <T k="Instant Delivery History" />
      </h1>
      <Link
        className="inline-flex min-h-11 items-center text-primary underline"
        href="/admin/instant-deliveries"
      >
        <T k="Back to Instant Deliveries" />
      </Link>
      <OperationalRefresh />
      <InstantHistoryView history={history} admin />
      <Link
        className="inline-flex min-h-11 items-center text-primary underline"
        href={`/admin/customers/${history.record.customer_id}`}
      >
        <T k="Open customer ledger" />
      </Link>
      <Link
        className="ml-3 inline-flex min-h-11 items-center text-primary underline"
        href="/admin/credit"
      >
        <T k="Collect outstanding credit" />
      </Link>
      {history.record.is_one_time && (
        <Card className="space-y-3">
          <h2 className="font-semibold">
            <T k="Convert to Regular Customer" />
          </h2>
          <p className="text-sm">
            <T k="Keep the same customer reference, invoices, payments and jar history." />
          </p>
          <OperationForm
            operation="instant-convert"
            id={id}
            requestKey={randomUUID()}
            label="Convert to Regular Customer"
            confirm="Convert this one-time customer without changing any financial or jar balances?"
          >
            <Field name="reason" label="Reason" required maxLength={500} />
          </OperationForm>
        </Card>
      )}
    </div>
  );
}
