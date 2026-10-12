import Link from "next/link";
import { T } from "@/components/localization";
import { getDriverAccounts } from "@/services/accounts";
import {
  DriverAccountForm,
  DriverAccessActions,
} from "@/components/account-forms";
import { DriverAccountSummary } from "@/components/driver-account-summary";
import { OperationsHeading } from "@/components/operations-layout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
export default async function Page() {
  const directory = await getDriverAccounts();
  return (
    <div className="space-y-6">
      <OperationsHeading
        title="Drivers"
        description="Review driver access. Names and email addresses come from existing accounts."
      />
      {!directory.available ? (
        <Card>
          <p role="status">
            <T k="The driver approval migration is required." />
          </p>
        </Card>
      ) : (
        <>
          {!directory.drivers.length && (
            <Card>
              <T k="No driver profiles yet. Create an Auth account, then add a pending driver below." />
            </Card>
          )}
          <div className="grid items-start gap-5 xl:grid-cols-2">
            {directory.drivers.map((driver) => (
              <Card key={driver.id} className="min-w-0 space-y-5">
                <h2 className="text-lg font-semibold">{driver.name}</h2>
                <DriverAccountSummary driver={driver} />
                <Button asChild variant="outline">
                  <Link href={`/admin/drivers/${driver.id}`}>
                    <T k="View Driver Details" />
                  </Link>
                </Button>
                <DriverAccessActions driver={driver} />
              </Card>
            ))}
          </div>
          <Card className="space-y-5">
            <h2 className="text-lg font-semibold">
              <T k="Add driver" />
            </h2>
            <p className="text-sm text-muted-foreground">
              <T k="Create the account in Supabase Dashboard → Authentication → Users using a deliverable email and a unique initial password. Give the credentials to the driver securely, then copy the existing user UUID here. Passwords are managed in Supabase Auth." />
            </p>
            <DriverAccountForm />
          </Card>
        </>
      )}
    </div>
  );
}
