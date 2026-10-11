import { getOperations } from "@/services/operations";
import { CustomerForm } from "@/components/master-forms";
import { Directory } from "@/components/directory";
import {
  OperationsHeading,
  MigrationRequired,
} from "@/components/operations-layout";
import { Card } from "@/components/ui/card";
export default async function Page() {
  const w = await getOperations(true);
  return (
    <div className="space-y-6">
      <OperationsHeading
        title="Customers"
        description="Manage operational records. Historical records are retained when you deactivate an entry."
      />
      {!w.available ? (
        <MigrationRequired />
      ) : (
        <>
          <Directory
            label="customers"
            href="/admin/customers"
            rows={w.customers.map((r) => ({
              id: r.id,
              name: r.name,
              detail: [r.shop_name, r.phone, r.address]
                .filter(Boolean)
                .join(" · "),
              active: r.is_active,
            }))}
          />
          <Card>
            <h2 className="mb-5 text-lg font-semibold">Add customer</h2>
            <CustomerForm />
          </Card>
        </>
      )}
    </div>
  );
}
