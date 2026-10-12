import { T, Message } from "@/components/localization";
import Link from "next/link";
import { randomUUID } from "node:crypto";
import { getDriverWorkspace } from "@/services/driver-workspace";
import { roundLabel } from "@/domain/operations/driver-workspace";
import { MigrationRequired, OperationsHeading } from "./operations-layout";
import { DeliveryForm, ReturnForm } from "./trip-forms";
import { OperationForm } from "./operation-form";
import { CollectCreditForm } from "./finance-payment";
import { DriverStock } from "./driver-stock";
import { OperationalRefresh } from "./operational-refresh";
import { Card } from "./ui/card";

export async function DriverRoundWorkspace({
  returning = false,
  initialCustomer,
}: {
  returning?: boolean;
  initialCustomer?: string;
}) {
  const {
    workspace: w,
    finance,
    trip,
    delivering,
    dayOpen,
  } = await getDriverWorkspace();
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Link
        href="/driver/home"
        className="inline-block py-2 text-primary underline"
      >
        <T k="Back to My Stock" />
      </Link>
      <OperationsHeading
        title={returning ? "Return to Warehouse" : "New Delivery"}
        description={
          trip ? (
            <T
              k="Round #{0} · {1} · {2}"
              values={[
                trip.trip_number,
                trip.plate_number,
                <Message key="status" value={roundLabel(trip.status)} />,
              ]}
            />
          ) : (
            "Waiting for a confirmed warehouse load."
          )
        }
      />
      {!w.available ? (
        <MigrationRequired />
      ) : !trip ? (
        <>
          <OperationalRefresh />
          <Card>
            <T k="No active delivery stock. Waiting for warehouse loading." />
          </Card>
        </>
      ) : (
        <>
          {returning && <DriverStock workspace={w} trip={trip} />}
          {delivering ? (
            <>
              <Card id={returning ? "submit-trip" : "add-delivery"}>
                {returning ? (
                  <ReturnForm
                    workspace={w}
                    trip={trip}
                    requestKey={randomUUID()}
                    admin={false}
                  />
                ) : (
                  <DeliveryForm
                    workspace={w}
                    finance={finance}
                    trip={trip}
                    requestKey={randomUUID()}
                    initialCustomer={initialCustomer}
                  />
                )}
              </Card>
              {!returning && finance.available && (
                <details className="rounded-xl border border-border bg-card p-4">
                  <summary className="min-h-12 cursor-pointer font-semibold">
                    <T k="Collect previous credit without a new delivery" />
                  </summary>
                  <div className="mt-4">
                    <CollectCreditForm
                      finance={finance}
                      workspace={w}
                      trip={trip}
                      requestKey={randomUUID()}
                    />
                  </div>
                </details>
              )}
            </>
          ) : (
            <>
              <OperationalRefresh />
              <Card className="space-y-4">
                <p>
                  <Message
                    value={
                      trip.status === "DRAFT"
                        ? "No active delivery stock. Waiting for warehouse loading."
                        : trip.status === "LOADED"
                          ? "Your stock is ready. Start delivering before saving a delivery."
                          : "Returned / Awaiting Confirmation. Your declaration is saved; admin must verify physical returns before another load."
                    }
                  />
                </p>
                {!dayOpen && (
                  <p role="alert">
                    <T k="This business day is locked for review or closed." />
                  </p>
                )}
                {trip.status === "LOADED" && dayOpen && (
                  <OperationForm
                    operation="start"
                    trip={trip.id}
                    requestKey={randomUUID()}
                    label="Start delivering"
                    confirm="Start delivering this confirmed load?"
                  />
                )}
                <Link
                  href={`/driver/trips/${trip.id}`}
                  className="inline-block py-3 text-primary underline"
                >
                  <T k="View saved round and return counts" />
                </Link>
              </Card>
            </>
          )}
        </>
      )}
    </div>
  );
}
