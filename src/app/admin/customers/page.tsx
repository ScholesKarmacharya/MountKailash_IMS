import { T } from "@/components/localization";
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
              displayDetail: (
                <>
                  {[r.shop_name, r.phone, r.address]
                    .filter(Boolean)
                    .join(" · ")}
                  {r.created_by_name && (
                    <T k=" · Added by {0}" values={[r.created_by_name]} />
                  )}
                </>
              ),
              detail: [
                r.shop_name,
                r.phone,
                r.address,
                r.created_by_name && `Added by ${r.created_by_name}`,
              ]
                .filter(Boolean)
                .join(" · "),
              active: r.is_active,
            }))}
          />
          <Card>
            <h2 className="mb-5 text-lg font-semibold">
              <T k="Add customer" />
            </h2>
            <CustomerForm />
          </Card>
        </>
      )}
    </div>
  );
}
