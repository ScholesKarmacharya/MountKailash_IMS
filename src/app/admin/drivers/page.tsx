import { getOperations } from "@/services/operations";
import { DriverForm } from "@/components/master-forms";
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
        title="Drivers"
        description="Provision new accounts through Supabase Auth first. Existing user IDs and roles are preserved."
      />
      {!w.available ? (
        <MigrationRequired />
      ) : (
        <>
          <Directory
            label="drivers"
            href="/admin/drivers"
            rows={w.drivers.map((r) => ({
              id: r.id,
              name: r.name,
              detail: "Authorized delivery account",
              active: r.is_active,
            }))}
          />
          <Card>
            <h2 className="mb-5 text-lg font-semibold">Add driver</h2>
            <p className="mb-5 text-sm text-muted-foreground">
              Create the account in Supabase Dashboard → Authentication → Users
              using a deliverable email and a unique initial password. Give the
              credentials to the driver securely, then copy the existing user
              UUID here. Passwords are managed in Supabase Auth.
            </p>
            <DriverForm />
          </Card>
        </>
      )}
    </div>
  );
}
