import Link from "next/link";
import { notFound } from "next/navigation";
import { getDriverAccounts, getDriverAudit } from "@/services/accounts";
import { T, DateValue, Message, LocalizedNav } from "@/components/localization";
import { AdminDialog } from "@/components/admin-dialog";
import { Button } from "@/components/ui/button";
import {
  DriverAccountForm,
  DriverAccessActions,
} from "@/components/account-forms";
import { DriverAccountSummary } from "@/components/driver-account-summary";
import { OperationsHeading } from "@/components/operations-layout";
import { Card } from "@/components/ui/card";
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ audit_page?: string }>;
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
  const q = await searchParams;
  const page = /^\d{1,4}$/.test(q.audit_page ?? "") ? Number(q.audit_page) : 0;
  const audit = await getDriverAudit(id, page);
  const actions: Record<string, string> = {
    DRIVER_ACCOUNT_SAVED: "Driver details saved",
    PROFILE_UPDATED: "Profile updated",
    DRIVER_STATUS_CHANGED: "Driver access changed",
    DRIVER_SAVED: "Driver details saved",
  };
  return (
    <div className="space-y-5" data-testid="driver-details-workspace">
      <Link className="text-primary underline" href="/admin/drivers">
        <T k="Back to drivers" />
      </Link>
      <OperationsHeading
        title="Driver details"
        description="Changes are audited. A record changed by another user must be reloaded before saving."
        actions={
          <AdminDialog
            languageSwitch
            title="Edit driver"
            triggerLabel="Edit driver"
          >
            <DriverAccountForm driver={driver} dialog />
          </AdminDialog>
        }
      />
      <Card className="space-y-5">
        <h2 className="text-lg font-semibold">{driver.name}</h2>
        <DriverAccountSummary driver={driver} />
        <details>
          <summary className="min-h-12 cursor-pointer text-sm font-medium">
            <T k="Account identifiers" />
          </summary>
          <p className="break-all text-sm text-muted-foreground">
            <T k="Authentication user ID" />: {driver.id}
          </p>
        </details>
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
      <Card className="space-y-4">
        <h2 className="text-lg font-semibold">
          <T k="Audit history" />
        </h2>
        {!audit.rows.length && (
          <p className="text-sm text-muted-foreground">
            <T k="No audit history recorded." />
          </p>
        )}
        {audit.rows.map((row) => (
          <article
            key={row.id}
            className="space-y-2 rounded-lg border border-border p-3 text-sm"
          >
            <div className="flex flex-wrap justify-between gap-2">
              <p className="font-semibold">
                <Message
                  value={actions[row.action] ?? row.action.replaceAll("_", " ")}
                />
              </p>
              <span className="text-muted-foreground">
                <DateValue value={row.created_at} time />
              </span>
            </div>
            <p>
              <T k="Changed by" />: {row.actor?.name ?? <T k="Not recorded" />}
            </p>
            <p className="break-words">{row.reason}</p>
            <details>
              <summary className="min-h-12 cursor-pointer font-medium">
                <T k="View audit details" />
              </summary>
              <pre className="whitespace-pre-wrap break-all rounded-lg bg-muted p-3 text-xs">
                {JSON.stringify(row, null, 2)}
              </pre>
            </details>
          </article>
        ))}
        <LocalizedNav
          aria-label="Audit history pages"
          className="flex flex-wrap gap-3"
        >
          {page > 0 && (
            <Button asChild variant="outline">
              <Link href={`/admin/drivers/${id}?audit_page=${page - 1}`}>
                <T k="Newer records" />
              </Link>
            </Button>
          )}
          {audit.hasMore && (
            <Button asChild variant="outline">
              <Link href={`/admin/drivers/${id}?audit_page=${page + 1}`}>
                <T k="Older records" />
              </Link>
            </Button>
          )}
        </LocalizedNav>
      </Card>
    </div>
  );
}
