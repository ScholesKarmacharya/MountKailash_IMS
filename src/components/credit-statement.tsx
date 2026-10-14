"use client";
import { LocalizedSelect } from "@/components/localization";

import { useState } from "react";
import { BsDateRange } from "./bs-date-picker";
import { T, Value, DateValue, Message, useLocale } from "./localization";
import { ReportPanel, ReportTable, MetricGrid } from "./report-ui";
import { Button } from "./ui/button";
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
  initialCustomer,
}: {
  finance: FinanceWorkspace;
  customers: { id: string; name: string }[];
  initialCustomer?: string;
}) {
  const { locale, t, number } = useLocale();
  const [bs, setBs] = useState(() => currentBs()),
    [range, setRange] = useState(() => bsMonthRange(bs.year, bs.month)),
    [customer, setCustomer] = useState(
      customers.find((c) => c.id === initialCustomer)?.id ??
        customers[0]?.id ??
        "",
    );
  const statement = creditStatement(finance, customer, range);
  const periodBs = adToBs(range.from),
    periodMonth = bsMonthRange(periodBs.year, periodBs.month);
  const query = new URLSearchParams({ from: range.from, to: range.to });
  return (
    <ReportPanel title="BS credit statement" testId="credit-statement">
      <p className="font-semibold">
        {customers.find((c) => c.id === customer)?.name ?? (
          <T k="No customers registered." />
        )}
      </p>
      <p className="text-sm text-muted-foreground">
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
      <MetricGrid
        items={[
          { label: "Opening credit", value: npr(statement.opening) },
          { label: "Period change", value: npr(statement.change) },
          { label: "Closing credit", value: npr(statement.closing) },
        ]}
      />
      <h3 className="font-semibold">
        <T k="Transaction ledger" />
      </h3>
      <ReportTable
        columns={["Date", "Kind", "Amount"]}
        empty="No transactions recorded."
        rows={statement.rows.map((row) => ({
          id: row.id,
          cells: [
            <DateValue key="date" value={row.created_at} time />,
            <Message key="kind" value={row.kind} />,
            <Value key="amount" value={npr(row.amount)} />,
          ],
        }))}
      />
      <p className="text-sm text-muted-foreground">
        <T k="Customer jars and refundable deposits are separate from this credit statement." />
      </p>
      {customer && (
        <div className="flex flex-wrap gap-4">
          <Button asChild variant="outline">
            <a
              href={`/api/customer-statements/${customer}?${query}&format=pdf`}
            >
              <T k="Download PDF" />
            </a>
          </Button>
          <Button asChild variant="outline">
            <a
              href={`/api/customer-statements/${customer}?${query}&format=csv`}
            >
              <T k="Download Excel-compatible CSV" />
            </a>
          </Button>
        </div>
      )}
    </ReportPanel>
  );
}
