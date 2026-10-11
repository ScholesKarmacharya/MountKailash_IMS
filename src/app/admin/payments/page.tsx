import Link from "next/link";
import { getFinance } from "@/services/finance";
import { getOperations } from "@/services/operations";
import {
  FinanceOverview,
  FinanceRequired,
} from "@/components/finance-overview";
import { Card } from "@/components/ui/card";
import { npr } from "@/domain/finance/money";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const [f, w, q] = await Promise.all([
    getFinance(true),
    getOperations(true),
    searchParams,
  ]);
  if (!f.available) return <FinanceRequired />;
  const day = q.day ?? w.days.find((d) => d.status === "OPEN")?.id ?? null;
  const dateOf = (id: string) =>
    w.days.find((d) => d.id === id)?.date_label ?? "";
  const payments = f.payments
    .filter((p) => {
      const t = w.trips.find((t) => t.id === p.trip_id),
        date = dateOf(p.business_day_id);
      return (
        (!q.customer || p.customer_id === q.customer) &&
        (!q.driver || t?.driver_id === q.driver) &&
        (!q.trip || p.trip_id === q.trip) &&
        (!q.method || p.method === q.method) &&
        (!q.status || p.status === q.status) &&
        (!q.from || date >= q.from) &&
        (!q.to || date <= q.to)
      );
    })
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Payments</h1>
      <p className="text-sm text-muted-foreground">
        Overview uses the selected business day. Collections include old credit
        and deposits; deposits remain outside sales. Cash is operator recorded.
        Fonepay confirmation is explicit admin reconciliation, with no automatic
        provider connection.
      </p>
      <form className="flex flex-wrap items-end gap-3">
        <Filter
          name="day"
          label="Overview business day"
          value={day ?? ""}
          options={w.days.map((d) => [d.id, `${d.date_label} (${d.status})`])}
        />
        <button className="min-h-12 rounded-lg bg-primary px-4 text-white">
          Update overview
        </button>
      </form>
      <FinanceOverview finance={f} day={day} />
      <Card>
        <h2 className="mb-4 font-semibold">Payment history filters</h2>
        <form className="grid gap-4 sm:grid-cols-3">
          <label className="grid gap-2 text-sm">
            Business date from
            <input
              className="min-h-12 rounded-lg border px-3"
              type="date"
              name="from"
              defaultValue={q.from}
            />
          </label>
          <label className="grid gap-2 text-sm">
            Business date to
            <input
              className="min-h-12 rounded-lg border px-3"
              type="date"
              name="to"
              defaultValue={q.to}
            />
          </label>
          <Filter
            name="customer"
            label="Customer"
            value={q.customer}
            options={w.customers.map((c) => [c.id, c.name])}
          />
          <Filter
            name="driver"
            label="Driver"
            value={q.driver}
            options={w.drivers.map((d) => [d.id, d.name])}
          />
          <Filter
            name="trip"
            label="Trip"
            value={q.trip}
            options={w.trips.map((t) => [t.id, `Trip ${t.trip_number}`])}
          />
          <Filter
            name="method"
            label="Method"
            value={q.method}
            options={["CASH", "FONEPAY"].map((s) => [s, s])}
          />
          <Filter
            name="status"
            label="Status"
            value={q.status}
            options={["PENDING", "CONFIRMED", "REJECTED", "REVERSED"].map(
              (s) => [s, s],
            )}
          />
          <input type="hidden" name="day" value={day ?? ""} />
          <button className="min-h-12 rounded-lg bg-primary px-4 text-white">
            Filter history
          </button>
          <Link href="/admin/payments" className="p-3 text-primary underline">
            Clear filters
          </Link>
        </form>
      </Card>
      <Card>
        <h2 className="mb-4 font-semibold">Receipts</h2>
        {payments.length === 0 ? (
          <p>No payments match these filters.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr>
                  {[
                    "Receipt",
                    "Customer",
                    "Business date",
                    "Method",
                    "Status",
                    "Amount",
                    "Deposit",
                  ].map((h) => (
                    <th key={h} className="p-3">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id} className="border-t">
                    <td className="p-3">
                      <Link
                        className="text-primary underline"
                        href={"/admin/payments/" + p.id}
                      >
                        R-{p.number.padStart(8, "0")}
                      </Link>
                    </td>
                    <td className="p-3">
                      {w.customers.find((c) => c.id === p.customer_id)?.name ??
                        "Walk-in"}
                    </td>
                    <td className="p-3">{dateOf(p.business_day_id)}</td>
                    <td className="p-3">{p.method}</td>
                    <td className="p-3">
                      {p.status === "CONFIRMED"
                        ? p.method === "CASH"
                          ? "Cash recorded"
                          : "Admin reconciled"
                        : p.status}
                    </td>
                    <td className="p-3">{npr(p.amount)}</td>
                    <td className="p-3">{npr(p.deposit_amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Card>
        <h2 className="mb-4 font-semibold">Invoices</h2>
        {f.invoices.length === 0 ? (
          <p>No invoices recorded.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {f.invoices.map((i) => (
              <Link
                key={i.id}
                className="rounded-lg border p-4 text-primary underline"
                href={"/admin/invoices/" + i.id}
              >
                MK-{i.number.padStart(8, "0")} · {i.customer.name} ·{" "}
                {npr(i.total)} · outstanding {npr(i.outstanding)}
              </Link>
            ))}
          </div>
        )}
      </Card>
      <Card>
        <details>
          <summary className="cursor-pointer font-semibold">
            Immutable finance audit journal
          </summary>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr>
                  {[
                    "Business date",
                    "Kind",
                    "Account",
                    "Amount",
                    "Source ID",
                    "Posting ID",
                  ].map((h) => (
                    <th key={h} className="p-2">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {f.journal.map((j) => (
                  <tr key={j.id} className="border-t">
                    <td className="p-2">{dateOf(j.business_day_id)}</td>
                    <td className="p-2">{j.kind}</td>
                    <td className="p-2">{j.account}</td>
                    <td className="p-2">{npr(j.amount)}</td>
                    <td className="p-2">{j.source_id}</td>
                    <td className="p-2">{j.posting_id}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {f.journal.length === 0 && <p>No finance postings recorded.</p>}
          </div>
        </details>
      </Card>
    </div>
  );
}
function Filter({
  name,
  label,
  value,
  options,
}: {
  name: string;
  label: string;
  value?: string;
  options: string[][];
}) {
  return (
    <div className="grid gap-2 text-sm">
      <label htmlFor={"finance-filter-" + name}>{label}</label>
      <select
        id={"finance-filter-" + name}
        className="min-h-12 rounded-lg border bg-background px-3"
        name={name}
        defaultValue={value ?? ""}
      >
        <option value="">All</option>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </div>
  );
}
