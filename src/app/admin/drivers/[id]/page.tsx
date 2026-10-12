import { T } from "@/components/localization";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getOperations } from "@/services/operations";
import { DriverForm } from "@/components/master-forms";
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
  const record = w.drivers.find((r) => r.id === id);
  if (!record) notFound();
  return (
    <div className="space-y-6">
      <Link className="text-primary underline" href="/admin/drivers">
        <T k="Back to drivers" />
      </Link>
      <OperationsHeading
        title="Edit driver"
        description="Changes are audited. A record changed by another user must be reloaded before saving."
      />
      <Card>
        <DriverForm driver={record} />
      </Card>
    </div>
  );
}
