import { getInstantWorkspace } from "@/services/instant";
import { InstantCards } from "@/components/instant-delivery";
import { OperationsHeading } from "@/components/operations-layout";
import { OperationalRefresh } from "@/components/operational-refresh";
export default async function Page() {
  return (
    <div className="space-y-6">
      <OperationsHeading
        title="Instant Deliveries"
        description="One-time event deliveries, reusable jars and payments."
      />
      <OperationalRefresh />
      <InstantCards workspace={await getInstantWorkspace(true)} admin />
    </div>
  );
}
