import Link from "next/link";
import { randomUUID } from "node:crypto";
import { getOperations } from "@/services/operations";
import { getFinance } from "@/services/finance";
import { npr, sum } from "@/domain/finance/money";
import { formatNepalTime } from "@/domain/business-days/time";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  MigrationRequired,
  OperationsHeading,
} from "@/components/operations-layout";
import { StockCards, TripList, LoadedStock } from "@/components/trip-summary";
import { OperationForm } from "@/components/operation-form";
import { getPendingJars } from "@/services/pending-jars";
import { PendingJars } from "@/components/pending-jars";
export default async function DriverHome() {
  const [overview, finance] = await Promise.all([
    getOperations(false),
    getFinance(false),
  ]);
  const trip = overview.trips.find((t) => t.status !== "CLOSED");
  const w = trip ? await getOperations(false, trip.id) : overview;
  const dayOpen =
    trip &&
    w.days.some((d) => d.id === trip.business_day_id && d.status === "OPEN");
  const operational = trip?.status === "ACTIVE" && dayOpen;
  const receipts = finance.payments.filter((p) => p.trip_id === trip?.id);
  const pending = operational ? await getPendingJars(false, trip.id) : null;
  const daySales = finance.sales.filter(
    (s) => s.business_day_id === trip?.business_day_id,
  );
  const dayInvoices = finance.invoices.filter((i) =>
    daySales.some((s) => s.id === i.sale_id),
  );
  const dayReceipts = finance.payments.filter(
    (p) => p.business_day_id === trip?.business_day_id,
  );
  const deliveries = w.visits.filter((v) =>
    w.items.some((i) => i.visit_id === v.id && i.full_jars + i.cartons > 0),
  ).length;
  const recentSales = w.visits.filter((v) =>
    w.items.some((i) => i.visit_id === v.id && i.full_jars + i.cartons > 0),
  );
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <OperationsHeading
        title="My day"
        description="Choose your customers, record deliveries and return your assigned stock."
      />
      {!w.available ? (
        <MigrationRequired />
      ) : trip ? (
        <>
          <Card className="space-y-4">
            <h2 className="text-sm font-semibold uppercase tracking-widest text-primary">
              My Active Trip
            </h2>
            <p className="text-2xl font-bold">
              Trip #{trip.trip_number} · {trip.plate_number}
            </p>
            <p className="text-sm text-muted-foreground">
              Business day {trip.date_label} ·{" "}
              {trip.status.replaceAll("_", " ")}
            </p>
            {operational ? (
              <>
                <Button asChild className="min-h-16 w-full text-lg">
                  <Link href={"/driver/trips/" + trip.id + "#add-delivery"}>
                    New Delivery
                  </Link>
                </Button>
                <div className="grid grid-cols-2 gap-3">
                  <Button asChild variant="outline" className="min-h-14">
                    <Link href={"/driver/trips/" + trip.id + "#add-customer"}>
                      Add / Find Customer
                    </Link>
                  </Button>
                  <Button asChild variant="outline" className="min-h-14">
                    <Link href={"/driver/trips/" + trip.id + "#submit-trip"}>
                      Submit Trip
                    </Link>
                  </Button>
                </div>
                <Button asChild variant="outline" className="min-h-14 w-full">
                  <Link href="#pending-jars">Pending Jars</Link>
                </Button>
              </>
            ) : trip.status === "LOADED" && dayOpen ? (
              <OperationForm
                operation="start"
                trip={trip.id}
                requestKey={randomUUID()}
                label="Start trip"
                confirm="Start this loaded trip?"
              />
            ) : (
              <p className="text-sm">
                {!dayOpen
                  ? "Operations are locked while the business day is under review or closed."
                  : trip.status === "DRAFT"
                    ? "Your admin is preparing the vehicle load."
                    : "Your submitted counts await warehouse verification."}
              </p>
            )}
            <Link
              className="inline-block py-3 font-semibold text-primary underline"
              href={"/driver/trips/" + trip.id}
            >
              View trip / return counts
            </Link>
          </Card>
          {w.loads.length > 0 && (
            <>
              <h2 className="font-semibold">Loaded Stock</h2>
              <LoadedStock workspace={w} trip={trip} />
              <h2 className="font-semibold">Remaining Stock</h2>
              <StockCards workspace={w} trip={trip} />
            </>
          )}
          <Card className="space-y-3">
            <h2 className="font-semibold">Trip activity</h2>
            <p>
              {deliveries} deliveries · {w.visits.length} customer visits
              (including return-only visits)
            </p>
            <p>
              {w.items.reduce((n, i) => n + i.empty_jars, 0)} empty jars
              collected
            </p>
          </Card>
          <Card className="space-y-3">
            <h2 className="font-semibold">Business-day totals</h2>
            <p className="text-sm text-muted-foreground">
              Your assigned business day {trip.date_label}, across your trips;
              it may extend past midnight.
            </p>
            {finance.available ? (
              <>
                <p>
                  Sales issued including tax:{" "}
                  <strong>{npr(sum(dayInvoices.map((i) => i.total)))}</strong>
                </p>
                <p>
                  Recorded confirmed collections:{" "}
                  <strong>
                    {npr(
                      sum(
                        dayReceipts
                          .filter((p) => p.status === "CONFIRMED")
                          .map((p) => p.amount),
                      ),
                    )}
                  </strong>
                </p>
                <p>
                  Recorded pending Fonepay (excluded):{" "}
                  {npr(
                    sum(
                      dayReceipts
                        .filter((p) => p.status === "PENDING")
                        .map((p) => p.amount),
                    ),
                  )}
                </p>
              </>
            ) : (
              <p>Finance migration required before daily totals can load.</p>
            )}
            <p className="text-xs text-muted-foreground">
              Receipt totals include explicit deposits. Admin reports reconcile
              refunds and financial corrections.
            </p>
          </Card>
          {pending && <PendingJars workspace={pending} />}
          <Card className="space-y-3">
            <h2 className="font-semibold">Payments Collected</h2>
            {finance.available ? (
              <>
                <p>
                  Cash:{" "}
                  <strong>
                    {npr(
                      sum(
                        receipts
                          .filter(
                            (p) =>
                              p.method === "CASH" && p.status === "CONFIRMED",
                          )
                          .map((p) => p.amount),
                      ),
                    )}
                  </strong>
                </p>
                <p>
                  Admin-reconciled Fonepay:{" "}
                  <strong>
                    {npr(
                      sum(
                        receipts
                          .filter(
                            (p) =>
                              p.method === "FONEPAY" &&
                              p.status === "CONFIRMED",
                          )
                          .map((p) => p.amount),
                      ),
                    )}
                  </strong>
                </p>
                <p>
                  Pending Fonepay:{" "}
                  {npr(
                    sum(
                      receipts
                        .filter((p) => p.status === "PENDING")
                        .map((p) => p.amount),
                    ),
                  )}{" "}
                  · excluded from confirmed collections
                </p>
                {!receipts.length && (
                  <p className="text-sm text-muted-foreground">
                    No receipts recorded for this trip.
                  </p>
                )}
              </>
            ) : (
              <p>
                Finance migration required before collection totals can load.
              </p>
            )}
          </Card>
          <Card>
            <h2 className="mb-4 font-semibold">Recent Sales</h2>
            {!recentSales.length && (
              <p className="text-sm text-muted-foreground">
                No deliveries recorded for this trip. Start with New Delivery.
              </p>
            )}
            {recentSales.slice(0, 5).map((v) => (
              <div
                key={v.id}
                className="space-y-2 border-b border-border py-4 last:border-0"
              >
                <p className="font-semibold">
                  {w.customers.find((c) => c.id === v.customer_id)?.name ??
                    v.walk_in_name}
                </p>
                <p className="text-sm">
                  {npr(v.value_snapshot)} water sales ·{" "}
                  {formatNepalTime(v.created_at)}
                </p>
                {w.items
                  .filter((i) => i.visit_id === v.id)
                  .map((i) => (
                    <p key={i.product_id} className="text-sm">
                      {i.full_jars} full jars · {i.empty_jars} empties ·{" "}
                      {i.cartons} cartons
                    </p>
                  ))}
              </div>
            ))}
          </Card>
        </>
      ) : (
        <Card>
          <h2 className="font-semibold">No assigned trip</h2>
          <p className="mt-3 text-sm text-muted-foreground">
            Your admin will assign a driver, vehicle and load before you can
            record deliveries.
          </p>
        </Card>
      )}
      {overview.available && (
        <>
          <h2 className="font-semibold">Recent trips</h2>
          <TripList
            trips={overview.trips.filter((t) => t.status === "CLOSED")}
            admin={false}
          />
        </>
      )}
      <p className="text-xs text-muted-foreground">
        Cash is recorded on receipt. Fonepay stays pending until admin
        reconciliation. End-trip counts require warehouse approval.
      </p>
    </div>
  );
}
