import Link from "next/link";
import type { HouseWorkspace } from "@/domain/house/types";
import { Card } from "./ui/card";
import { StatusBadge } from "./ui/status-badge";
import { T, Value, DateValue } from "./localization";

export function HouseCustomerCards({
  customers,
}: {
  customers: HouseWorkspace["customers"];
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:hidden">
      {customers.map((customer) => (
        <Card key={customer.id} className="min-w-0 space-y-2 p-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <Link
              href={"/admin/customers/" + customer.id}
              className="inline-flex min-h-11 items-center break-words rounded font-semibold text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
            >
              {customer.name}
            </Link>
            <StatusBadge
              label={
                customer.house_status === "APPROVED"
                  ? "Approved"
                  : customer.house_status === "SUSPENDED"
                    ? "Suspended"
                    : "Approval Required"
              }
              tone={
                customer.house_status === "APPROVED" ? "positive" : "warning"
              }
            />
          </div>
          <p className="break-words text-sm text-muted-foreground">
            {customer.phone || "—"} · {customer.address || "—"}
          </p>
          <dl className="grid grid-cols-2 gap-3 border-t border-border pt-3 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">
                <T k="Jars Supplied" />
              </dt>
              <dd className="mt-1 font-bold">
                <Value value={customer.jars_supplied} />
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">
                <T k="Unreturned Jars" />
              </dt>
              <dd className="mt-1 font-bold">
                <Value value={customer.unreturned_jars} />
              </dd>
            </div>
            <div className="col-span-2">
              <dt className="text-xs text-muted-foreground">
                <T k="Last Delivery Date" />
              </dt>
              <dd className="mt-1">
                {customer.last_delivery ? (
                  <DateValue value={customer.last_delivery} />
                ) : (
                  "—"
                )}
              </dd>
            </div>
          </dl>
        </Card>
      ))}
    </div>
  );
}
