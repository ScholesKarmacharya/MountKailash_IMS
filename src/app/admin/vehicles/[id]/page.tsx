import { T } from "@/components/localization";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getOperations } from "@/services/operations";
import { VehicleForm } from "@/components/master-forms";
import {
  OperationsHeading,
  MigrationRequired,
} from "@/components/operations-layout";
import { Card } from "@/components/ui/card";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const w = await getOperations(true);
  if (!w.available) return <MigrationRequired />;
  const record = w.vehicles.find((r) => r.id === id);
  if (!record) notFound();
  return (
    <div className="space-y-6">
      <Link className="text-primary underline" href="/admin/vehicles">
        <T k="Back to vehicles" />
      </Link>
      <OperationsHeading
        title="Edit vehicle"
        description="Changes are audited. A record changed by another user must be reloaded before saving."
      />
      <Card>
        <VehicleForm
          vehicle={record}
          hasOpenTrip={w.trips.some(
            (t) => t.vehicle_id === id && t.status !== "CLOSED",
          )}
        />
      </Card>
    </div>
  );
}
