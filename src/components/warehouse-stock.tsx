import { Message, Value, T, LocalizedSection } from "@/components/localization";
import { Card } from "./ui/card";
import {
  stockKinds,
  stockLabels,
  stockTotals,
} from "@/domain/inventory/validation";
import type { Balance } from "@/data-access/inventory";
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
      className="grid gap-4 sm:grid-cols-3"
    >
      {stockKinds.map((kind) => (
        <Card key={kind}>
          <h2 className="text-sm font-semibold">
            <Message value={stockLabels[kind]} />
          </h2>
          <p className="my-4 text-3xl font-bold">
            {available ? <Value value={totals[kind]} /> : <T k="Unavailable" />}
          </p>
          <p className="text-xs text-muted-foreground">
            <Message
              value={
                available
                  ? "Current warehouse quantity · carries across business days"
                  : "Apply the reviewed Sprint 1 migration to enable stock."
              }
            />
          </p>
        </Card>
      ))}
    </LocalizedSection>
  );
}
