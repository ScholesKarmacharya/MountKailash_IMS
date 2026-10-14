import { T } from "@/components/localization";
import { getOperations } from "@/services/operations";
import { CustomerForm } from "@/components/master-forms";
import { Directory } from "@/components/directory";
import {
  OperationsHeading,
  MigrationRequired,
} from "@/components/operations-layout";
import { AdminDialog } from "@/components/admin-dialog";
import { Phone, MapPin, Store } from "lucide-react";
export default async function Page() {
  const w = await getOperations(true);
  return (
    <div className="space-y-5" data-testid="customers-workspace">
      <OperationsHeading
        title="Customers"
        description="Manage operational records. Historical records are retained when you deactivate an entry."
        actions={
          w.available && (
            <AdminDialog
              languageSwitch
              title="Add customer"
              triggerLabel="Add customer"
              primary
            >
              <CustomerForm dialog />
            </AdminDialog>
          )
        }
      />
      {!w.available ? (
        <MigrationRequired />
      ) : (
        <>
          <Directory
            label="customers"
            href="/admin/customers"
            rows={w.customers
              .filter((r) => !r.is_one_time)
              .map((r) => ({
                id: r.id,
                name: r.name,
                displayDetail: (
                  <>
                    <dl className="space-y-2">
                      {r.shop_name && (
                        <div className="flex gap-2">
                          <dt>
                            <Store className="size-4 mt-0.5" aria-hidden />
                            <span className="sr-only">
                              <T k="Shop / business" />
                            </span>
                          </dt>
                          <dd>{r.shop_name}</dd>
                        </div>
                      )}
                      <div className="flex gap-2">
                        <dt>
                          <Phone className="size-4 mt-0.5" aria-hidden />
                          <span className="sr-only">
                            <T k="Phone" />
                          </span>
                        </dt>
                        <dd>{r.phone || <T k="Not recorded" />}</dd>
                      </div>
                      <div className="flex gap-2">
                        <dt>
                          <MapPin className="size-4 mt-0.5" aria-hidden />
                          <span className="sr-only">
                            <T k="Address" />
                          </span>
                        </dt>
                        <dd>{r.address || <T k="Not recorded" />}</dd>
                      </div>
                    </dl>
                  </>
                ),
                detail: [r.shop_name, r.phone, r.address]
                  .filter(Boolean)
                  .join(" · "),
                active: r.is_active,
                type: r.supply_type === "HOUSE" ? "HOUSE" : "Regular Customer",
              }))}
          />
        </>
      )}
    </div>
  );
}
