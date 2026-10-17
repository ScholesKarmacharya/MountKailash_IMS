import { T, Message, Value, LocalizedSection } from "@/components/localization";
import type { Trip, Workspace } from "@/domain/operations/types";
import type { FinanceWorkspace } from "@/domain/finance/types";
import { roundStock, roundFinance } from "@/domain/operations/driver-workspace";
import { npr } from "@/domain/finance/money";
import { Card } from "./ui/card";

export function DriverStockSummary({
  workspace,
  trip,
  returning = false,
}: {
  workspace: Workspace;
  trip: Trip;
  returning?: boolean;
}) {
  const s = roundStock(workspace, trip);
  const metrics: [string, number, string][] = [
    ["Full Jars", s.remainingFull, "driver-remaining-full-jars"],
    [
      "Empty Jars",
      returning ? s.remainingEmpty : s.collectedEmpty,
      "driver-empty-jars-collected",
    ],
    ["Cartons", s.remainingCartons, "driver-cartons-remaining"],
  ];
  return (
    <section className="space-y-3" aria-label="Delivery stock">
      <h2 className="text-sm font-semibold text-muted-foreground">
        <T
          k={
            returning
              ? "Remaining stock"
              : trip.status === "LOADED"
                ? "Loaded stock"
                : "Today's stock"
          }
        />
      </h2>
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        {metrics.map(([label, count, test]) => (
          <Card key={label} className="min-w-0 px-3 py-4">
            <p className="text-xs font-semibold text-muted-foreground">
              <T k={label} />
            </p>
            <p
              className="mt-2 text-3xl font-bold tabular-nums text-primary"
              data-testid={returning ? `return-${test}` : test}
            >
              <Value value={count} />
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              <T
                k={
                  label === "Empty Jars" && !returning
                    ? "collected"
                    : "remaining"
                }
              />
            </p>
          </Card>
        ))}
      </div>
    </section>
  );
}

export function DriverStock({
  workspace,
  trip,
}: {
  workspace: Workspace;
  trip: Trip;
}) {
  const s = roundStock(workspace, trip);
  return (
    <LocalizedSection aria-label="Delivery stock" className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        {[
          ["Total Jars Loaded", s.loadedFull],
          ["Remaining Full Jars", s.remainingFull],
          ["Full Jars Sold", s.soldFull],
          ["Empty Jars Collected", s.collectedEmpty],
        ].map(([label, value]) => (
          <Card
            key={label}
            className={
              label === "Remaining Full Jars"
                ? "border-primary bg-primary text-white"
                : ""
            }
          >
            <h2 className="text-sm font-semibold">
              <Message value={label} />
            </h2>
            <p
              className="mt-3 text-4xl font-bold tabular-nums"
              data-testid={`driver-${String(label).toLowerCase().replaceAll(" ", "-")}`}
            >
              <Value value={value} />
            </p>
          </Card>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Total Cartons Loaded", s.loadedCartons],
          ["Cartons Sold", s.soldCartons],
          ["Cartons Remaining", s.remainingCartons],
          ["Total Customer Visits", s.visits],
        ].map(([label, value]) => (
          <Card key={label} className="p-4">
            <h2 className="text-xs font-semibold text-muted-foreground">
              <Message value={label} />
            </h2>
            <p className="mt-2 text-2xl font-bold tabular-nums">
              <Value value={value} />
            </p>
          </Card>
        ))}
      </div>
      <p className="text-sm text-muted-foreground">
        <T
          k="{0} deliveries · {1} customer visits (including return-only visits)"
          values={[s.deliveries, <Value key="v1" value={s.visits} />]}
        />
      </p>
      {trip.status === "CLOSED" && (
        <Card>
          <h2 className="font-semibold">
            <T k="Confirmed warehouse returns" />
          </h2>
          <p className="mt-2">
            <T
              k="{0} full jars · {1} empty jars · {2} cartons"
              values={[s.returnedFull, s.returnedEmpty, s.returnedCartons]}
            />
          </p>
        </Card>
      )}
    </LocalizedSection>
  );
}

export function DriverMoney({
  finance,
  trip,
  day,
}: {
  finance: FinanceWorkspace;
  trip?: string;
  day?: string;
}) {
  const f = roundFinance(finance, trip, day);
  return (
    <LocalizedSection
      aria-label={trip ? "Round payments" : "Business-day totals"}
      className="space-y-3"
    >
      <h2 className="font-semibold">
        <Message
          value={trip ? "Round sales and collections" : "Business-day totals"}
        />
      </h2>
      {f.available ? (
        <div className="grid grid-cols-2 gap-3">
          {[
            [trip ? "Sales" : "Today's Sales", f.sales],
            ["Cash Collected", f.cash],
            ["Fonepay Pending", f.fonepayPending],
            ["Fonepay Verified", f.fonepayVerified],
            ["Credit Issued", f.creditIssued],
          ].map(([label, value]) => (
            <Card key={label} className="p-4">
              <h3 className="text-xs font-semibold text-muted-foreground">
                <Message value={label} />
              </h3>
              <p className="mt-2 break-words text-lg font-bold tabular-nums">
                <Value value={npr(value!)} />
              </p>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <p>
            <T k="Finance migration required before totals can load." />
          </p>
        </Card>
      )}
    </LocalizedSection>
  );
}
