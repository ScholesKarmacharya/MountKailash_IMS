import type { DriverAccount } from "@/domain/auth/accounts";
import { approvalLabels } from "@/domain/auth/roles";
import { DateValue, T } from "./localization";
import { StatusBadge } from "./ui/status-badge";
export function DriverAccountSummary({ driver }: { driver: DriverAccount }) {
  return (
    <dl className="grid min-w-0 gap-4 text-sm sm:grid-cols-2">
      <div>
        <dt className="text-muted-foreground">
          <T k="Email address" />
        </dt>
        <dd className="break-all">{driver.email ?? "—"}</dd>
      </div>
      <div>
        <dt className="text-muted-foreground">
          <T k="Phone (optional)" />
        </dt>
        <dd>{driver.phone || "—"}</dd>
      </div>
      <div>
        <dt className="text-muted-foreground">
          <T k="Account Status" />
        </dt>
        <dd role="status" className="font-semibold text-primary">
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
        </dd>
      </div>
      <div>
        <dt className="text-muted-foreground">
          <T k="Approval date" />
        </dt>
        <dd>
          {driver.approved_at ? (
            <DateValue value={driver.approved_at} time />
          ) : (
            <T k="Not recorded" />
          )}
        </dd>
      </div>
      <div>
        <dt className="text-muted-foreground">
          <T k="Approved by" />
        </dt>
        <dd>{driver.approved_by_name ?? <T k="Not recorded" />}</dd>
      </div>
      <div>
        <dt className="text-muted-foreground">
          <T k="Assigned vehicle" />
        </dt>
        <dd>
          {driver.assigned_vehicles.length ? (
            driver.assigned_vehicles.join(", ")
          ) : (
            <T k="No assigned vehicle" />
          )}
        </dd>
      </div>
      <div>
        <dt className="text-muted-foreground">
          <T k="Recent activity" />
        </dt>
        <dd>
          {driver.recent_activity ? (
            <DateValue value={driver.recent_activity} time />
          ) : (
            <T k="No activity recorded" />
          )}
        </dd>
      </div>
    </dl>
  );
}
