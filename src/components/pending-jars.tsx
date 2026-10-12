"use client";
import {
  T,
  Message,
  DateValue,
  Value,
  useLocale,
} from "@/components/localization";
import Link from "next/link";
import { useState } from "react";
import { BsDateRange } from "./bs-date-picker";
import { Input } from "./ui/input";
import { inDateRange } from "@/domain/localization/calendar";
import { Card } from "./ui/card";

import type { PendingJarWorkspace } from "@/domain/operations/pending-jars";
import { pendingDays } from "@/domain/operations/pending-age";
export function PendingJars({
  workspace,
  admin = false,
  title = "Pending Jars",
  asOf,
}: {
  workspace: PendingJarWorkspace;
  admin?: boolean;
  title?: string;
  asOf?: string | null;
}) {
  const { t } = useLocale();
  const [search, setSearch] = useState("");
  const [range, setRange] = useState({ from: "", to: "" });
  const rows = workspace.rows.filter(
    (r) =>
      `${r.customer_name} ${r.product_name}`
        .toLowerCase()
        .includes(search.toLowerCase()) &&
      inDateRange(r.original_date, range.from, range.to),
  );
  return (
    <Card id="pending-jars" className="space-y-4">
      <h2 className="font-semibold">
        <Message value={title} />
      </h2>
      <label className="grid gap-2 text-sm">
        <T k="Search customers" />
        <Input
          type="search"
          aria-label={t("Search customers")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </label>
      <BsDateRange onChange={(from, to) => setRange({ from, to })} />
      {!workspace.available ? (
        <p role="status">
          <T k="The pending-jar or driver lookup migration is required before these dated balances can load." />
        </p>
      ) : (
        <>
          <p>
            <strong>
              <T
                k="{0} pending jars"
                values={[
                  <Value
                    key="v0"
                    value={rows.reduce((n, r) => n + r.pending, 0)}
                  />,
                ]}
              />
            </strong>
          </p>
          <p className="text-sm text-muted-foreground">
            <T k="Empty returns settle the oldest outstanding jars first. Original delivery dates carry forward; financial credit is separate." />
          </p>
          {!rows.length && (
            <p>
              <T k="No pending jars." />
            </p>
          )}
          <ul className="divide-y divide-border">
            {rows.map((r) => (
              <li key={r.entry_id} className="space-y-1 py-3 text-sm">
                {admin ? (
                  <Link
                    className="font-semibold text-primary underline"
                    href={`/admin/customers/${r.customer_id}`}
                  >
                    {r.customer_name}
                  </Link>
                ) : (
                  <p className="font-semibold">{r.customer_name}</p>
                )}
                <p>
                  <T
                    k="{0} outstanding of {1} {2}"
                    values={[
                      <Value key="v0" value={r.pending} />,
                      <Value key="v1" value={r.quantity} />,
                      r.product_name,
                    ]}
                  />
                </p>
                <p>
                  <T
                    k="Original date: {0} · business day {1}"
                    values={[
                      <DateValue key="v0" value={r.original_date} time />,
                      <DateValue key="v1" value={r.business_date} />,
                    ]}
                  />
                </p>
                {r.source !== "Delivery" && (
                  <p className="text-muted-foreground">
                    <T
                      k="{0}; this date is the correction date."
                      values={[<Message key="v0" value={r.source} />]}
                    />
                  </p>
                )}
                <p>
                  <T
                    k="{0} days pending {1} {2}"
                    values={[
                      <Value
                        key="v0"
                        value={pendingDays(
                          r.original_date,
                          asOf ? new Date(asOf) : new Date(),
                        )}
                      />,
                      r.trip_number != null && (
                        <T
                          key="round"
                          k=" · Round #{0}"
                          values={[r.trip_number]}
                        />
                      ),
                      r.driver_name && ` · ${r.driver_name}`,
                    ]}
                  />
                </p>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}
