import { LocalizedSelect } from "@/components/localization";
import { BsDateRange } from "@/components/bs-date-picker";
import { inDateRange } from "@/domain/localization/calendar";
import { getDayHistory } from "@/services/business-days";
import { T, Message, DateValue, Value } from "@/components/localization";
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
  const history = await getDayHistory();
  const day = q.day ?? w.days.find((d) => d.status === "OPEN")?.id ?? null;
  const dateOf = (id: string) =>
    history.days.find((d) => d.id === id)?.date_label ?? "";
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
  const invoices = f.invoices.filter((i) =>
    inDateRange(i.date_label, q.from, q.to, false),
  );
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">
        <T k="Payments" />
      </h1>
      <p className="text-sm text-muted-foreground">
        <T k="Overview uses the selected business day. Collections include old credit and deposits; deposits remain outside sales. Cash is operator recorded. Fonepay confirmation is explicit admin reconciliation, with no automatic provider connection." />
      </p>
      <form className="flex flex-wrap items-end gap-3">
        <Filter
          name="day"
          label="Overview business day"
          value={day ?? ""}
          options={history.days.map((d) => [
            d.id,
            `${d.date_label} (${d.status})`,
          ])}
        />
        <button className="min-h-12 rounded-lg bg-primary px-4 text-white">
          <T k="Update overview" />
        </button>
      </form>
      <FinanceOverview finance={f} day={day} />
      <Card>
        <h2 className="mb-4 font-semibold">
          <T k="Payment history filters" />
        </h2>
        <form className="grid gap-4 sm:grid-cols-3">
          <BsDateRange from={q.from} to={q.to} />
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
            <T k="Filter history" />
          </button>
          <Link href="/admin/payments" className="p-3 text-primary underline">
            <T k="Clear filters" />
          </Link>
        </form>
      </Card>
      <Card>
        <h2 className="mb-4 font-semibold">
          <T k="Receipts" />
        </h2>
        {payments.length === 0 ? (
          <p>
            <T k="No payments match these filters." />
          </p>
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
                      <Message value={h} />
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
                        <T k="R-{0}" values={[p.number.padStart(8, "0")]} />
                      </Link>
                    </td>
                    <td className="p-3">
                      {w.customers.find((c) => c.id === p.customer_id)
                        ?.name ?? <T k="Walk-in" />}
                    </td>
                    <td className="p-3">
                      <DateValue value={dateOf(p.business_day_id)} />
                    </td>
                    <td className="p-3">
                      <Message value={p.method} />
                    </td>
                    <td className="p-3">
                      <Message
                        value={
                          p.status === "CONFIRMED"
                            ? p.method === "CASH"
                              ? "Cash recorded"
                              : "Admin reconciled"
                            : p.status
                        }
                      />
                    </td>
                    <td className="p-3">
                      <Value value={npr(p.amount)} />
                    </td>
                    <td className="p-3">
                      <Value value={npr(p.deposit_amount)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Card>
        <h2 className="mb-4 font-semibold">
          <T k="Invoices" />
        </h2>
        {invoices.length === 0 ? (
          <p>
            <T k="No invoices recorded." />
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {invoices.map((i) => (
              <Link
                key={i.id}
                className="rounded-lg border p-4 text-primary underline"
                href={"/admin/invoices/" + i.id}
              >
                <T
                  k="MK-{0} · {1} · {2} · outstanding {3}"
                  values={[
                    i.number.padStart(8, "0"),
                    i.customer.name,
                    <Value key="v2" value={npr(i.total)} />,
                    <Value key="v3" value={npr(i.outstanding)} />,
                  ]}
                />
              </Link>
            ))}
          </div>
        )}
      </Card>
      <Card>
        <details>
          <summary className="cursor-pointer font-semibold">
            <T k="Immutable finance audit journal" />
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
                      <Message value={h} />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {f.journal.map((j) => (
                  <tr key={j.id} className="border-t">
                    <td className="p-2">
                      <DateValue value={dateOf(j.business_day_id)} />
                    </td>
                    <td className="p-2">
                      <Message value={j.kind} />
                    </td>
                    <td className="p-2">
                      <Message value={j.account} />
                    </td>
                    <td className="p-2">
                      <Value value={npr(j.amount)} />
                    </td>
                    <td className="p-2">{j.source_id}</td>
                    <td className="p-2">{j.posting_id}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {f.journal.length === 0 && (
              <p>
                <T k="No finance postings recorded." />
              </p>
            )}
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
      <label htmlFor={"finance-filter-" + name}>
        <Message value={label} />
      </label>
      <LocalizedSelect
        id={"finance-filter-" + name}
        className="min-h-12 rounded-lg border bg-background px-3"
        name={name}
        defaultValue={value ?? ""}
      >
        <option value="">
          <T k="All" />
        </option>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {name === "day" ? (
              <>
                <DateValue value={l?.slice(0, 10)} /> (
                <Message value={l?.slice(12, -1)} />)
              </>
            ) : ["method", "status", "trip"].includes(name) ? (
              <Message value={l} />
            ) : (
              l
            )}
          </option>
        ))}
      </LocalizedSelect>
    </div>
  );
}
