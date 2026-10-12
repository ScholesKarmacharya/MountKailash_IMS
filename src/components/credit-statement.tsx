"use client";
import { LocalizedSelect } from "@/components/localization";

import { useState } from "react";
import { BsDateRange } from "./bs-date-picker";
import { T, Value, DateValue, Message, useLocale } from "./localization";
import { Card } from "./ui/card";
import {
  bsMonthRange,
  adToBs,
  canonicalRange,
  currentBs,
  months,
  MIN_BS_YEAR,
  MAX_BS_YEAR,
} from "@/domain/localization/calendar";
import { creditStatement } from "@/domain/finance/statement";
import type { FinanceWorkspace } from "@/domain/finance/types";
import { npr } from "@/domain/finance/money";
export function CreditStatement({
  finance,
  customers,
}: {
  finance: FinanceWorkspace;
  customers: { id: string; name: string }[];
}) {
  const { locale, t, number } = useLocale();
  const [bs, setBs] = useState(() => currentBs()),
    [range, setRange] = useState(() => bsMonthRange(bs.year, bs.month)),
    [customer, setCustomer] = useState(customers[0]?.id ?? "");
  const statement = creditStatement(finance, customer, range);
  const periodBs = adToBs(range.from),
    periodMonth = bsMonthRange(periodBs.year, periodBs.month);
  const query = new URLSearchParams({ from: range.from, to: range.to });
  return (
    <Card className="space-y-4">
      <h2 className="text-xl font-semibold">
        <T k="BS credit statement" />
      </h2>
      <p>
        {range.from === periodMonth.from && range.to === periodMonth.to && (
          <>
            {months[locale][periodBs.month - 1]} {number(periodBs.year)} ·{" "}
          </>
        )}
        <DateValue value={range.from} /> – <DateValue value={range.to} />
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="grid gap-2 text-sm">
          <T k="Customer" />
          <LocalizedSelect
            aria-label={t("Statement customer")}
            className="min-h-12 rounded-lg border bg-background px-3"
            value={customer}
            onChange={(e) => setCustomer(e.target.value)}
          >
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </LocalizedSelect>
        </label>
        <label className="grid gap-2 text-sm">
          <T k="BS month" />
          <LocalizedSelect
            aria-label={t("Statement month")}
            className="min-h-12 rounded-lg border bg-background px-3"
            value={bs.month}
            onChange={(e) => {
              const next = { ...bs, month: Number(e.target.value) };
              setBs(next);
              setRange(bsMonthRange(next.year, next.month));
            }}
          >
            {months[locale].map((m, i) => (
              <option key={i} value={i + 1}>
                {m}
              </option>
            ))}
          </LocalizedSelect>
        </label>
        <label className="grid gap-2 text-sm">
          <T k="BS year" />
          <LocalizedSelect
            aria-label={t("Statement year")}
            className="min-h-12 rounded-lg border bg-background px-3"
            value={bs.year}
            onChange={(e) => {
              const next = { ...bs, year: Number(e.target.value) };
              setBs(next);
              setRange(bsMonthRange(next.year, next.month));
            }}
          >
            {Array.from(
              { length: MAX_BS_YEAR - MIN_BS_YEAR + 1 },
              (_, i) => i + MIN_BS_YEAR,
            ).map((y) => (
              <option key={y} value={y}>
                {number(y)}
              </option>
            ))}
          </LocalizedSelect>
        </label>
      </div>
      <BsDateRange
        controlled
        from={range.from}
        to={range.to}
        onChange={(from, to) => {
          if (from && to) {
            setRange(canonicalRange(from, to));
            setBs(adToBs(from));
          }
        }}
      />
      <p>
        <T
          k="Opening credit: {0}"
          values={[<Value key="opening" value={npr(statement.opening)} />]}
        />
      </p>
      {!statement.rows.length && (
        <p>
          <T k="No transactions recorded." />
        </p>
      )}
      <ul className="divide-y">
        {statement.rows.map((row) => (
          <li key={row.id} className="flex flex-wrap gap-3 py-3 text-sm">
            <DateValue value={row.created_at} time />
            <Message value={row.kind} />
            <Value value={npr(row.amount)} />
          </li>
        ))}
      </ul>
      <p>
        <T
          k="Period change: {0}"
          values={[<Value key="change" value={npr(statement.change)} />]}
        />
      </p>
      <p className="font-semibold">
        <T
          k="Closing credit: {0}"
          values={[<Value key="closing" value={npr(statement.closing)} />]}
        />
      </p>
      <p className="text-sm text-muted-foreground">
        <T k="Customer jars and refundable deposits are separate from this credit statement." />
      </p>
      {customer && (
        <div className="flex flex-wrap gap-4">
          <a
            className="text-primary underline"
            href={`/api/customer-statements/${customer}?${query}&format=pdf`}
          >
            <T k="Download PDF" />
          </a>
          <a
            className="text-primary underline"
            href={`/api/customer-statements/${customer}?${query}&format=csv`}
          >
            <T k="Download Excel-compatible CSV" />
          </a>
        </div>
      )}
    </Card>
  );
}
