import Link from "next/link";
import { notFound } from "next/navigation";
import { getDriverAccounts } from "@/services/accounts";
import { T } from "@/components/localization";
import {
  DriverAccountForm,
  DriverAccessActions,
} from "@/components/account-forms";
import { DriverAccountSummary } from "@/components/driver-account-summary";
import { OperationsHeading } from "@/components/operations-layout";
import { Card } from "@/components/ui/card";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const directory = await getDriverAccounts();
  if (!directory.available)
    return (
      <Card>
        <T k="The driver approval migration is required." />
      </Card>
    );
  const driver = directory.drivers.find((d) => d.id === id);
  if (!driver) notFound();
  return (
    <div className="space-y-6">
      <Link className="text-primary underline" href="/admin/drivers">
        <T k="Back to drivers" />
      </Link>
      <OperationsHeading
        title="Driver details"
        description="Changes are audited. A record changed by another user must be reloaded before saving."
      />
      <Card className="space-y-5">
        <h2 className="text-lg font-semibold">{driver.name}</h2>
        <DriverAccountSummary driver={driver} />
        <p className="break-all text-xs text-muted-foreground">
          <T k="Authentication user ID" />: {driver.id}
        </p>
      </Card>
      <Card className="space-y-5">
        <h2 className="text-lg font-semibold">
          <T k="Account access" />
        </h2>
        <DriverAccessActions driver={driver} />
        <p className="text-sm text-muted-foreground">
          <T k="Suspension blocks new driver operations immediately. Assigned trips and all historical records remain available to admins." />
        </p>
      </Card>
      <Card className="space-y-5">
        <h2 className="text-lg font-semibold">
          <T k="Edit driver" />
        </h2>
        <DriverAccountForm driver={driver} />
      </Card>
    </div>
  );
}
