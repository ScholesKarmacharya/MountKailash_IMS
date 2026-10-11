import { requirePermission } from "@/services/auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { Plus } from "lucide-react";
export default async function DriverHome() {
  await requirePermission("driver:read");
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-primary">
          Delivery workspace
        </p>
        <h1 className="text-3xl font-bold">My day</h1>
        <p className="mt-2 text-muted-foreground">
          Your assigned trip and customer visits.
        </p>
      </div>
      <Card>
        <h2 className="font-semibold">
          Assigned trip{" "}
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            Not yet live
          </span>
        </h2>
        <EmptyState
          title="Trip assignments are not connected"
          description="Your admin-assigned trip, loaded stock and return status will appear here in Sprint 2."
        />
      </Card>
      <Card>
        <h2 className="mb-3 font-semibold">New customer visit</h2>
        <p id="visit-help" className="mb-5 text-sm text-muted-foreground">
          Not yet live. Recording visits requires an assigned open trip and
          server-validated inventory. Repeated customer visits will be
          supported.
        </p>
        <Button disabled aria-describedby="visit-help" className="w-full">
          <Plus className="size-4" aria-hidden="true" />
          New visit · Coming in Sprint 2
        </Button>
      </Card>
      <p className="text-sm text-muted-foreground">
        Trip submission will request admin reconciliation. Your declaration will
        not approve warehouse returns.
      </p>
    </div>
  );
}
