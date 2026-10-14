import { T, LocalizedSection } from "@/components/localization";
import { Card } from "@/components/ui/card";
import { TripList } from "@/components/trip-summary";
import { getAdminDashboard } from "@/services/dashboard";
import { AdminDriverActivity } from "@/components/admin-driver-activity";
import {
  OverviewHeader,
  OverviewStock,
  OverviewFinance,
  OverviewTripStatus,
  OverviewClosing,
  OverviewPrepared,
  OverviewActivity,
} from "@/components/admin-overview";
import {
  overviewFinance,
  overviewTripGroups,
} from "@/domain/operations/admin-overview";
import { ChevronDown } from "lucide-react";

export default async function Dashboard() {
  const {
    businessDay,
    latestDay,
    updatedAt,
    inventory,
    operations,
    finance,
    dayDetail,
  } = await getAdminDashboard();
  const groups = overviewTripGroups(
    operations,
    businessDay,
    dayDetail?.report,
    latestDay?.date_label,
  );
  const metrics = overviewFinance(dayDetail, finance, businessDay?.id ?? null);
  const priority = [
    "ACTIVE",
    "LOADED",
    "DRAFT",
    "DISCREPANCY",
    "SUBMITTED",
    "UNDER_REVIEW",
    "CLOSED",
  ];
  const trips = [...groups.today].sort(
    (a, b) =>
      priority.indexOf(a.status) - priority.indexOf(b.status) ||
      a.trip_number - b.trip_number,
  );
  return (
    <div className="min-w-0 space-y-5" data-testid="admin-overview">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-primary">
          <T k="Warehouse overview" />
        </p>
        <h1 className="mt-1 text-2xl font-bold sm:text-3xl">
          <T k="Operations dashboard" />
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          <T k="Your business day, deliveries and balances in one place." />
        </p>
      </div>
      <OverviewHeader
        day={businessDay}
        latestDay={latestDay}
        updatedAt={updatedAt}
      />
      <OverviewStock inventory={inventory} />
      <OverviewFinance metrics={metrics} dayOpen={!!businessDay} />
      <OverviewTripStatus
        groups={groups}
        available={operations.available}
        hasDay={!!businessDay}
      />
      <div className="grid items-start gap-4 xl:grid-cols-2">
        <OverviewClosing
          detail={dayDetail}
          workspace={operations}
          hasDay={!!businessDay}
        />
        <OverviewPrepared report={dayDetail?.report} groups={groups} />
      </div>
      <AdminDriverActivity
        overview={operations}
        finance={finance}
        trips={trips}
        day={businessDay?.id}
        openedAt={businessDay?.opened_at}
      />
      <LocalizedSection aria-label="Open trip queue">
        <Card className="p-4">
          <details className="group">
            <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-3 text-sm font-semibold">
              <T k="Open trip queue" />
              <ChevronDown
                className="size-4 shrink-0 group-open:rotate-180"
                aria-hidden="true"
              />
            </summary>
            <div className="border-t border-border pt-3">
              {operations.available ? (
                <TripList
                  trips={trips.filter((t) => t.status !== "CLOSED")}
                  admin
                />
              ) : (
                <p className="text-sm text-muted-foreground">
                  <T k="Trip data could not be loaded. Refresh or open Trips to review." />
                </p>
              )}
            </div>
          </details>
        </Card>
      </LocalizedSection>
      {dayDetail && (
        <OverviewActivity report={dayDetail.report} workspace={operations} />
      )}
    </div>
  );
}
