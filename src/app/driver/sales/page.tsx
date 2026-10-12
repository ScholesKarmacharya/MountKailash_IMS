import Link from "next/link";
import { getDriverWorkspace } from "@/services/driver-workspace";
import { npr } from "@/domain/finance/money";
import { formatNepalTime } from "@/domain/business-days/time";
import { Card } from "@/components/ui/card";
import { TripList } from "@/components/trip-summary";
import { OperationalRefresh } from "@/components/operational-refresh";
export default async function Page() {
  const { overview, finance } = await getDriverWorkspace();
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <h1 className="text-3xl font-bold">Sales History</h1>
      <OperationalRefresh />
      {!finance.available ? (
        <Card>Finance migration required before sales can load.</Card>
      ) : (
        <>
          <Card>
            <h2 className="mb-4 font-semibold">Invoices</h2>
            {!finance.invoices.length && <p>No sales recorded.</p>}
            <ul className="divide-y divide-border">
              {[...finance.invoices]
                .sort((a, b) => b.created_at.localeCompare(a.created_at))
                .map((i) => (
                  <li key={i.id} className="space-y-2 py-4">
                    <Link
                      className="font-semibold text-primary underline"
                      href={`/driver/invoices/${i.id}`}
                    >
                      Invoice MK-{i.number.padStart(8, "0")} · {i.customer.name}
                    </Link>
                    <p className="text-sm">
                      {formatNepalTime(i.created_at)} · business day{" "}
                      {i.date_label}
                    </p>
                    <p className="text-sm">
                      Total {npr(i.total)} · outstanding {npr(i.outstanding)}
                    </p>
                  </li>
                ))}
            </ul>
          </Card>
          <Card>
            <h2 className="mb-4 font-semibold">Collections</h2>
            {!finance.payments.length && <p>No collections recorded.</p>}
            <ul className="divide-y divide-border">
              {[...finance.payments]
                .sort((a, b) => b.created_at.localeCompare(a.created_at))
                .map((p) => (
                  <li key={p.id} className="space-y-2 py-4">
                    <Link
                      className="font-semibold text-primary underline"
                      href={`/driver/payments/${p.id}`}
                    >
                      Receipt MK-P-{p.number.padStart(8, "0")} ·{" "}
                      {p.customer_snapshot.name}
                    </Link>
                    <p className="text-sm">
                      {p.method} ·{" "}
                      {p.status === "CONFIRMED" && p.method === "FONEPAY"
                        ? "Admin verified"
                        : p.status}{" "}
                      · {npr(p.amount)} · {formatNepalTime(p.created_at)}
                    </p>
                  </li>
                ))}
            </ul>
          </Card>
        </>
      )}
      <h2 className="font-semibold">Delivery rounds and empty returns</h2>
      <TripList trips={overview.trips} admin={false} />
    </div>
  );
}
