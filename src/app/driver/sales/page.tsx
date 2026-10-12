import { invoicePaymentStatus, invoiceTotals } from "@/domain/finance/reports";
import { ProductDeliverySummary } from "@/components/product-delivery-summary";
import { getTripHistory } from "@/services/history";
import { BsDateRange } from "@/components/bs-date-picker";
import { inDateRange } from "@/domain/localization/calendar";
import { Button } from "@/components/ui/button";
import { T, Message, DateValue, Value } from "@/components/localization";
import Link from "next/link";
import { getDriverWorkspace } from "@/services/driver-workspace";
import { npr } from "@/domain/finance/money";

import { Card } from "@/components/ui/card";
import { TripList } from "@/components/trip-summary";
import { OperationalRefresh } from "@/components/operational-refresh";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const q = await searchParams;
  const { overview, finance } = await getDriverWorkspace();
  const trips = (await getTripHistory(q.from, q.to, false)) ?? overview.trips;
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <h1 className="text-3xl font-bold">
        <T k="Sales History" />
      </h1>
      <OperationalRefresh />
      <form className="space-y-3">
        <BsDateRange from={q.from} to={q.to} />
        <Button type="submit">
          <T k="Filter history" />
        </Button>
      </form>
      {!finance.available ? (
        <Card>
          <T k="Finance migration required before sales can load." />
        </Card>
      ) : (
        <>
          <Card>
            <h2 className="mb-4 font-semibold">
              <T k="Invoices" />
            </h2>
            {!finance.invoices.length && (
              <p>
                <T k="No sales recorded." />
              </p>
            )}
            <ul className="divide-y divide-border">
              {finance.invoices
                .filter((i) => inDateRange(i.created_at, q.from, q.to))
                .sort((a, b) => b.created_at.localeCompare(a.created_at))
                .map((i) => (
                  <li key={i.id} className="space-y-2 py-4">
                    <Link
                      className="font-semibold text-primary underline"
                      href={`/driver/invoices/${i.id}`}
                    >
                      <T
                        k="Invoice MK-{0} · {1}"
                        values={[i.number.padStart(8, "0"), i.customer.name]}
                      />
                    </Link>
                    <p className="text-sm">
                      <T
                        k="{0} · business day {1}"
                        values={[
                          <DateValue key="v0" value={i.created_at} time />,
                          <DateValue key="v1" value={i.date_label} />,
                        ]}
                      />
                    </p>
                    <p className="text-sm">
                      <T k="Payment Status" />:{" "}
                      <Message value={invoicePaymentStatus(i, finance)} />
                    </p>
                    {(finance.delivery_items ?? [])
                      .filter((line) =>
                        finance.sales.some(
                          (sale) =>
                            sale.id === i.sale_id &&
                            sale.visit_id === line.visit_id,
                        ),
                      )
                      .map((line) => (
                        <ProductDeliverySummary
                          key={line.product_id}
                          line={line}
                        />
                      ))}
                    <p className="text-sm">
                      <T k="Total Amount" />:{" "}
                      <Value value={npr(invoiceTotals(i, finance).effective)} />{" "}
                      · <T k="Outstanding" />:{" "}
                      <Value value={npr(i.outstanding)} />
                    </p>
                  </li>
                ))}
            </ul>
          </Card>
          <Card>
            <h2 className="mb-4 font-semibold">
              <T k="Collections" />
            </h2>
            {!finance.payments.length && (
              <p>
                <T k="No collections recorded." />
              </p>
            )}
            <ul className="divide-y divide-border">
              {finance.payments
                .filter((p) => inDateRange(p.created_at, q.from, q.to))
                .sort((a, b) => b.created_at.localeCompare(a.created_at))
                .map((p) => (
                  <li key={p.id} className="space-y-2 py-4">
                    <Link
                      className="font-semibold text-primary underline"
                      href={`/driver/payments/${p.id}`}
                    >
                      <T
                        k="Receipt MK-P-{0} · {1}"
                        values={[
                          p.number.padStart(8, "0"),
                          p.customer_snapshot.name,
                        ]}
                      />
                    </Link>
                    <p className="text-sm">
                      <Message value={p.method} /> ·{" "}
                      <Message
                        value={
                          p.status === "CONFIRMED" && p.method === "FONEPAY"
                            ? "Admin verified"
                            : p.status
                        }
                      />{" "}
                      · <Value value={npr(p.amount)} /> ·{" "}
                      <DateValue value={p.created_at} time />
                    </p>
                  </li>
                ))}
            </ul>
          </Card>
        </>
      )}
      <h2 className="font-semibold">
        <T k="Delivery rounds and empty returns" />
      </h2>
      <TripList trips={trips} admin={false} />
    </div>
  );
}
