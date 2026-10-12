import { T } from "@/components/localization";
import { getDriverWorkspace } from "@/services/driver-workspace";
import { DriverCustomers } from "@/components/driver-customers";
import { MigrationRequired } from "@/components/operations-layout";
export default async function Page() {
  const { workspace, trip, delivering } = await getDriverWorkspace();
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <h1 className="text-3xl font-bold">
        <T k="Customers" />
      </h1>
      {workspace.available ? (
        <DriverCustomers
          workspace={workspace}
          trip={delivering ? trip : undefined}
        />
      ) : (
        <MigrationRequired />
      )}
    </div>
  );
}
