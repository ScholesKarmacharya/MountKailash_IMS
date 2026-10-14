import { Message, Value, T, LocalizedSection } from "@/components/localization";
import { Card } from "./ui/card";
import {
  stockKinds,
  stockLabels,
  stockTotals,
} from "@/domain/inventory/validation";
import type { Balance } from "@/data-access/inventory";
import { Droplets, Package, RotateCcw } from "lucide-react";
export function WarehouseStock({
  balances,
  available,
}: {
  balances: Balance[];
  available: boolean;
}) {
  const totals = stockTotals(balances);
  return (
    <LocalizedSection
      aria-label="Warehouse stock"
      className="grid grid-cols-2 gap-3 sm:grid-cols-3"
    >
      {stockKinds.map((kind) => (
        <Card
          key={kind}
          className={
            "min-w-0 p-4 " +
            (kind === "BOTTLE_CARTON" ? "col-span-2 sm:col-span-1" : "")
          }
        >
          <div className="flex items-start justify-between gap-2">
            <h2 className="text-sm font-semibold text-muted-foreground">
              <Message value={stockLabels[kind]} />
            </h2>
            {kind === "FULL_JAR" ? (
              <Droplets
                className="size-5 shrink-0 text-primary"
                aria-hidden="true"
              />
            ) : kind === "EMPTY_JAR" ? (
              <RotateCcw
                className="size-5 shrink-0 text-primary"
                aria-hidden="true"
              />
            ) : (
              <Package
                className="size-5 shrink-0 text-primary"
                aria-hidden="true"
              />
            )}
          </div>
          <p
            className="mt-2 break-words text-2xl font-bold tabular-nums text-primary"
            data-testid={"warehouse-" + kind}
          >
            {available ? <Value value={totals[kind]} /> : <T k="Unavailable" />}
          </p>
        </Card>
      ))}
    </LocalizedSection>
  );
}
