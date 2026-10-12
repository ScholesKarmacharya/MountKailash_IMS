import { T, Message, Value, LocalizedSection } from "@/components/localization";
import type { Trip, Workspace } from "@/domain/operations/types";
import type { FinanceWorkspace } from "@/domain/finance/types";
import { roundStock, roundFinance } from "@/domain/operations/driver-workspace";
import { npr } from "@/domain/finance/money";
import { Card } from "./ui/card";

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
            <p className="mt-3 text-4xl font-bold tabular-nums">
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
      <p className="text-xs text-muted-foreground">
        <T k="Sales include configured tax and invoice corrections. Cash and verified Fonepay use receipt journals, including reversals and explicit deposits. Previous-credit collections are separate from sales. Fonepay requires independent admin reconciliation; deposit refunds appear in admin reports." />
      </p>
    </LocalizedSection>
  );
}
