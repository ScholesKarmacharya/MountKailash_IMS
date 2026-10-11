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
  return (
    <div className="space-y-6">
      <Link className="text-primary underline" href="/admin/customers">
        Back to customers
      </Link>
      <OperationsHeading
        title="Edit customer"
        description="Changes are audited. A record changed by another user must be reloaded before saving."
      />
      <Card>
        <CustomerForm customer={record} />
      </Card>
      <CustodyForm workspace={w} customer={record} />
      <CustomerReport id={id} />
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
