import { getOperations } from "@/services/operations";
import { VehicleForm } from "@/components/master-forms";
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
        title="Vehicles"
        description="Manage operational records. Historical records are retained when you deactivate an entry."
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
            }))}
          />
          <Card>
            <h2 className="mb-5 text-lg font-semibold">Add vehicle</h2>
            <VehicleForm />
          </Card>
        </>
      )}
    </div>
  );
}
