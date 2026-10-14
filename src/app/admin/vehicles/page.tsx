import { T } from "@/components/localization";
import { getOperations } from "@/services/operations";
import { VehicleForm } from "@/components/master-forms";
import { Directory } from "@/components/directory";
import {
  OperationsHeading,
  MigrationRequired,
} from "@/components/operations-layout";
import { AdminDialog } from "@/components/admin-dialog";
import Link from "next/link";
import { tripLabel } from "@/domain/operations/trip-presentation";
import { StatusBadge } from "@/components/ui/status-badge";
export default async function Page() {
  const w = await getOperations(true);
  return (
    <div className="space-y-5" data-testid="vehicles-workspace">
      <OperationsHeading
        title="Vehicles"
        description="Manage operational records. Historical records are retained when you deactivate an entry."
        actions={
          w.available && (
            <AdminDialog
              languageSwitch
              title="Add vehicle"
              triggerLabel="Add vehicle"
              primary
            >
              <VehicleForm dialog />
            </AdminDialog>
          )
        }
      />
      {!w.available ? (
        <MigrationRequired />
      ) : (
        <>
          <Directory
            label="vehicles"
            href="/admin/vehicles"
            rows={w.vehicles.map((r) => ({
              id: r.id,
              name: r.plate_number,
              detail: r.description,
              active: r.is_active,
              displayDetail: (
                <div className="space-y-2">
                  {r.description && <p>{r.description}</p>}
                  {w.trips
                    .filter(
                      (t) => t.vehicle_id === r.id && t.status !== "CLOSED",
                    )
                    .map((trip) => (
                      <div
                        key={trip.id}
                        className="space-y-1 border-t border-border pt-2"
                      >
                        <p>
                          <T k="Assigned driver" />:{" "}
                          <span className="font-medium text-foreground">
                            {trip.driver_name}
                          </span>
                        </p>
                        <div className="flex flex-wrap items-center gap-2">
                          <Link
                            className="min-h-12 inline-flex items-center font-medium text-primary underline"
                            href={`/admin/trips/${trip.id}`}
                          >
                            <T k="Trip #{0}" values={[trip.trip_number]} />
                          </Link>
                          <StatusBadge label={tripLabel(trip)} />
                        </div>
                      </div>
                    ))}
                  {!w.trips.some(
                    (t) => t.vehicle_id === r.id && t.status !== "CLOSED",
                  ) && (
                    <p>
                      <T k="No current trip assignment" />
                    </p>
                  )}
                </div>
              ),
            }))}
          />
        </>
      )}
    </div>
  );
}
