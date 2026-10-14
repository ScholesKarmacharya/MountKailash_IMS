import Link from "next/link";
import type { JarHistory } from "@/domain/operations/admin-jars";
import { T, Message, DateValue, Value } from "./localization";
import { Card } from "./ui/card";
import { PendingJars } from "./pending-jars";

export function CustomerJarHistory({ history }: { history: JarHistory }) {
  const { customer, balances, events } = history;
  return (
    <div className="space-y-4">
      <Card className="space-y-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-xl font-bold">
              <T k="Customer History" /> · {customer.name}
            </h2>
            <p className="mt-2 break-words text-sm text-muted-foreground">
              {[customer.phone, customer.address].filter(Boolean).join(" · ")}
            </p>
            <p className="mt-1 text-sm">
              <T k="Customer type" />: <Message value={customer.supply_type} />
            </p>
          </div>
          <div className="rounded-lg border border-primary/15 bg-primary/5 px-4 py-3 text-primary">
            <p className="text-xs font-medium">
              <T k="Outstanding Balance" />
            </p>
            <p className="mt-1 text-2xl font-bold">
              <T
                k="{0} Jars"
                values={[balances.reduce((n, b) => n + b.quantity, 0)]}
              />
            </p>
          </div>
        </div>
        {balances.map((b) => (
          <p key={b.product_id} className="text-sm">
            {b.product_name}: <Value value={b.quantity} />
          </p>
        ))}
        <Link
          href={`/admin/customers/${customer.id}#customer-custody`}
          className="inline-block text-sm font-semibold text-primary underline"
        >
          <T k="Audited jar correction" />
        </Link>
        <p className="text-xs text-muted-foreground">
          <T k="Corrections require a jar product, signed quantity and reason. Admin identity and time are recorded; historical transactions remain unchanged." />
        </p>
      </Card>
      <Card className="space-y-4 p-5">
        <h3 className="font-semibold">
          <T k="Complete jar history" />
        </h3>
        <p className="text-xs text-muted-foreground">
          <T k="Confirmed transactions only, in ledger posting order. Device occurrence dates are shown after successful synchronization." />
        </p>
        {!events.length && (
          <p className="text-sm">
            <T k="No jar activity" />
          </p>
        )}
        <ol className="divide-y divide-border">
          {events.map((event) => (
            <li key={event.id} className="space-y-3 py-4">
              <div className="flex flex-wrap items-start justify-between gap-2 text-sm">
                <div>
                  <p className="font-semibold">
                    <DateValue value={event.occurred_at} time />
                  </p>
                  <p className="mt-1">
                    {event.driver_name ?? event.actor_name}
                    {event.trip_id && (
                      <>
                        {" "}
                        ·{" "}
                        <Link
                          className="text-primary underline"
                          href={`/admin/trips/${event.trip_id}`}
                        >
                          <T k="Trip #{0}" values={[event.trip_number!]} />
                        </Link>
                      </>
                    )}
                  </p>
                </div>
                <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-primary">
                  <T k="Server-confirmed" />
                  {event.offline && (
                    <>
                      {" "}
                      · <T k="Synced" />
                    </>
                  )}
                </span>
              </div>
              {event.offline && (
                <p className="text-xs text-muted-foreground">
                  <T k="Confirmed at" />:{" "}
                  <DateValue value={event.confirmed_at} time />
                </p>
              )}
              {event.correction && (
                <p className="text-sm">
                  <T k="Admin custody correction" />:{" "}
                  <Message value={event.reason} />
                </p>
              )}
              {event.items.map((item) => (
                <div
                  key={item.product_id}
                  className="rounded-lg border border-border bg-muted/40 p-3 text-sm"
                >
                  <p className="mb-2 font-semibold">{item.product_name}</p>
                  <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <div>
                      <dt className="text-xs text-muted-foreground">
                        <T k="Jars Delivered" />
                      </dt>
                      <dd className="font-semibold">
                        <Value value={item.delivered} />
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">
                        <T k="Empty Jars Returned" />
                      </dt>
                      <dd className="font-semibold">
                        <Value value={item.returned} />
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">
                        <T k="Net jar change" />
                      </dt>
                      <dd className="font-semibold">
                        <Value value={item.net_change} />
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">
                        <T k="Product balance after transaction" />
                      </dt>
                      <dd className="font-semibold">
                        <Value value={item.product_balance} />
                      </dd>
                    </div>
                  </dl>
                </div>
              ))}
              <p className="text-sm font-semibold">
                <T k="Outstanding after transaction" />:{" "}
                <T k="{0} Jars" values={[event.outstanding_after]} />
              </p>
            </li>
          ))}
        </ol>
      </Card>
      <PendingJars
        workspace={{ available: true, rows: history.pending }}
        title="Oldest outstanding deliveries (FIFO)"
      />
      <Card className="p-5">
        <details>
          <summary className="cursor-pointer font-semibold">
            <T k="FIFO return allocation history" />
          </summary>
          <p className="mt-3 text-xs text-muted-foreground">
            <T k="Returns and negative corrections settle earlier custody entries first, using the existing ledger allocation rules." />
          </p>
          {!history.allocations.length && (
            <p className="mt-3 text-sm">
              <T k="No return allocations recorded." />
            </p>
          )}
          <ul className="mt-3 divide-y divide-border">
            {history.allocations.map((a) => (
              <li
                key={`${a.return_entry_id}-${a.delivery_entry_id}`}
                className="space-y-1 py-3 text-sm"
              >
                <p className="font-semibold">
                  {
                    balances.find((b) => b.product_id === a.product_id)
                      ?.product_name
                  }{" "}
                  · <T k="{0} Jars" values={[a.quantity]} />
                </p>
                <p>
                  <T k="Original custody date" />:{" "}
                  <DateValue value={a.original_date} time />
                </p>
                <p>
                  <Message value={a.source} />:{" "}
                  <DateValue value={a.returned_at} time />
                </p>
              </li>
            ))}
          </ul>
        </details>
      </Card>
    </div>
  );
}
