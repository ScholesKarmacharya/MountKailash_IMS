import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import { getAdminDashboard } from "@/services/dashboard";
import { formatNepalTime, isOvernightDay } from "@/domain/business-days/time";
import { WarehouseStock } from "@/components/warehouse-stock";
import Link from "next/link";
const metrics = [
  {
    title: "Pending trips",
    description: "Assignment and reconciliation arrive in Sprint 2.",
  },
  {
    title: "Collected payments",
    description: "Cash and pending Fonepay records arrive in Sprint 3.",
  },
  {
    title: "Outstanding credit",
    description: "Customer receivables arrive in Sprint 3.",
  },
];
export default async function Dashboard() {
  const { businessDay, inventory } = await getAdminDashboard();
  return (
    <div className="space-y-7">
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-primary">
          Warehouse overview
        </p>
        <h1 className="text-3xl font-bold">Operations dashboard</h1>
        <p className="mt-2 text-muted-foreground">
          Your business day, deliveries and balances in one place.
        </p>
      </div>
      <Card className="border-l-4 border-l-primary">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold">Business day</h2>
          <span className="rounded-full bg-muted px-3 py-1 text-xs">
            {businessDay?.status.replaceAll("_", " ") ?? "No active day"}
          </span>
        </div>
        {businessDay ? (
          <>
            <p className="mt-4 text-2xl font-bold">{businessDay.date_label}</p>
            <p className="mt-2 text-sm text-muted-foreground">
              Opened {formatNepalTime(businessDay.opened_at)} (Nepal time)
            </p>
            {isOvernightDay(businessDay.date_label) && (
              <p
                role="status"
                className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900"
              >
                This business day continues from an earlier calendar date.
                Review it before starting another day.
              </p>
            )}
          </>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">
            No open business day is recorded. Open a day from warehouse
            inventory before posting stock adjustments. Closing arrives in
            Sprint 4.
          </p>
        )}
      </Card>
      <WarehouseStock
        balances={inventory.balances}
        available={inventory.available}
      />
      <Link
        className="inline-block text-sm font-semibold text-primary underline"
        href="/admin/inventory"
      >
        Manage warehouse inventory
      </Link>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {metrics.map((metric) => (
          <Card key={metric.title}>
            <h2 className="text-sm font-semibold">{metric.title}</h2>
            <p className="my-5 text-lg font-bold text-muted-foreground">
              Not yet available
            </p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {metric.description}
            </p>
          </Card>
        ))}
      </div>
      <Card>
        <EmptyState
          title="Trip queue is not yet live"
          description="Assigned, submitted and unresolved trips will appear here once trip services are implemented. Trip totals are not yet calculated."
        />
      </Card>
      <p className="text-sm text-muted-foreground">
        Collections will include repayments of prior credit. Refundable deposits
        will remain separate from sales. Payment verification is not connected.
      </p>
    </div>
  );
}
