import { T, DateValue } from "@/components/localization";
import { getFinance } from "@/services/finance";
import { FinanceRequired } from "@/components/finance-overview";
import { CustomerBillingForms } from "@/components/finance-admin-forms";
import { CustomerFinance } from "@/components/customer-finance";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getOperations } from "@/services/operations";
import { CustomerForm, CustodyForm } from "@/components/master-forms";
import {
  OperationsHeading,
  MigrationRequired,
} from "@/components/operations-layout";
import { CustomerReport } from "@/components/customer-report";
import { Card } from "@/components/ui/card";
import { getPendingJars } from "@/services/pending-jars";
import { PendingJars } from "@/components/pending-jars";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [w, f] = await Promise.all([getOperations(true), getFinance(true)]);
  if (!w.available) return <MigrationRequired />;
  const record = w.customers.find((r) => r.id === id);
  if (!record) notFound();
  const pending = await getPendingJars(true, undefined, id);
  return (
    <div className="space-y-6">
      <Link className="text-primary underline" href="/admin/customers">
        <T k="Back to customers" />
      </Link>
      <OperationsHeading
        title="Edit customer"
        description="Changes are audited. A record changed by another user must be reloaded before saving."
      />
      <Card>
        <details className="mb-4 rounded-lg border border-border p-3">
          <summary className="min-h-12 cursor-pointer font-medium">
            <T k="Customer creation details" />
          </summary>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">
                <T k="Added by" />
              </dt>
              <dd>{record.created_by_name || <T k="Not recorded" />}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">
                <T k="Created at" />
              </dt>
              <dd>
                <DateValue value={record.created_at} time />
              </dd>
            </div>
          </dl>
        </details>
        <CustomerForm customer={record} />
        {(record.contact_person ||
          record.customer_type ||
          record.delivery_notes) && (
          <div className="mt-4 space-y-2 border-t pt-4 text-sm">
            <p>
              <T
                k="Contact person: {0}"
                values={[record.contact_person || "Not recorded"]}
              />
            </p>
            <p>
              <T
                k="Customer type: {0}"
                values={[record.customer_type || "Not recorded"]}
              />
            </p>
            <p>
              <T
                k="Delivery notes: {0}"
                values={[record.delivery_notes || "None recorded"]}
              />
            </p>
          </div>
        )}
      </Card>
      <CustodyForm workspace={w} customer={record} />
      <CustomerReport id={id} />
      <PendingJars workspace={pending} admin />
      {f.available ? (
        <>
          <CustomerFinance id={id} finance={f} />
          <CustomerBillingForms id={id} finance={f} workspace={w} />
        </>
      ) : (
        <FinanceRequired />
      )}
    </div>
  );
}
