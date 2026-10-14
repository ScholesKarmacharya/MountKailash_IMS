import Link from "next/link";
import { T } from "@/components/localization";
import { getDriverAccounts } from "@/services/accounts";
import { DriverAccountForm } from "@/components/account-forms";
import { DateValue } from "@/components/localization";
import { StatusBadge } from "@/components/ui/status-badge";
import { approvalLabels } from "@/domain/auth/roles";
import { AdminDialog } from "@/components/admin-dialog";
import { UserRound } from "lucide-react";
import { OperationsHeading } from "@/components/operations-layout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
export default async function Page() {
  const directory = await getDriverAccounts();
  return (
    <div className="space-y-5" data-testid="drivers-workspace">
      <OperationsHeading
        title="Drivers"
        description="Review driver access. Names and email addresses come from existing accounts."
        actions={
          directory.available && (
            <AdminDialog
              languageSwitch
              title="Add driver"
              triggerLabel="Add driver"
              primary
            >
              <div className="mb-5 space-y-3 rounded-lg bg-muted p-3 text-sm">
                <p className="font-semibold">
                  <T k="Link an existing authentication account" />
                </p>
                <p>
                  <T k="Ask the account administrator to provision the driver's email account in Supabase Auth, then link its user ID here. In-app invitations require a separate secure account setup workflow." />
                </p>
                <p>
                  <T k="Pending drivers cannot use operations. After approval, the driver signs in online and sets up offline access on their trusted device." />
                </p>
              </div>
              <DriverAccountForm dialog />
            </AdminDialog>
          )
        }
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
              <T k="No driver profiles yet. Use Add driver to link an existing account." />
            </Card>
          )}
          <div className="grid items-start gap-3 xl:grid-cols-2">
            {directory.drivers.map((driver) => (
              <Card
                key={driver.id}
                data-testid={`driver-card-${driver.id}`}
                className="min-w-0 space-y-4 p-4 sm:p-5"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <h2 className="flex min-w-0 items-center gap-2 break-words font-semibold">
                    <UserRound
                      className="size-5 shrink-0 text-primary"
                      aria-hidden
                    />
                    {driver.name}
                  </h2>
                  <StatusBadge
                    label={
                      driver.approval_status === "APPROVED" && !driver.is_active
                        ? "Inactive"
                        : approvalLabels[driver.approval_status]
                    }
                    tone={
                      driver.is_active && driver.approval_status === "APPROVED"
                        ? "positive"
                        : "warning"
                    }
                  />
                </div>
                <dl className="grid gap-3 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-muted-foreground">
                      <T k="Assigned vehicle" />
                    </dt>
                    <dd className="mt-1 break-words">
                      {driver.assigned_vehicles.length ? (
                        driver.assigned_vehicles.join(", ")
                      ) : (
                        <T k="No assigned vehicle" />
                      )}
                    </dd>
                  </div>
                  {driver.phone && (
                    <div>
                      <dt className="text-muted-foreground">
                        <T k="Phone" />
                      </dt>
                      <dd className="mt-1">{driver.phone}</dd>
                    </div>
                  )}
                  <div>
                    <dt className="text-muted-foreground">
                      <T k="Last activity" />
                    </dt>
                    <dd className="mt-1">
                      {driver.recent_activity ? (
                        <DateValue value={driver.recent_activity} time />
                      ) : (
                        <T k="No activity recorded" />
                      )}
                    </dd>
                  </div>
                </dl>
                <Button asChild variant="outline" className="w-full sm:w-auto">
                  <Link href={`/admin/drivers/${driver.id}`}>
                    <T k="View Driver Details" />
                  </Link>
                </Button>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
