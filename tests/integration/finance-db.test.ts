import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, beforeEach, afterEach, it, expect } from "vitest";
import { receiptPdf } from "@/services/pdf";
import { invoiceDocument } from "@/domain/finance/documents";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { financeMetrics } from "@/domain/finance/reports";
import type { DeliveryCustomerContext } from "@/domain/operations/customer-context";
const admin = randomUUID(),
  driver = randomUUID(),
  other = randomUUID();
const jar = randomUUID(),
  carton = randomUUID(),
  customer = randomUUID(),
  vehicle = randomUUID(),
  trip = randomUUID();
let db: PGlite, day: string;
async function who(id: string) {
  await db.exec("reset role; set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
}
async function rpc(name: string, args: unknown[]) {
  return (
    await db.query<{ id: string }>(
      `select public.${name}(${args.map((_, i) => `$${i + 1}`).join(",")}) as id`,
      args,
    )
  ).rows[0]!.id;
}
async function scalar(sql: string, args: unknown[] = []) {
  return Object.values((await db.query(sql, args)).rows[0]!)[0];
}
async function rejects(name: string, args: unknown[], message: RegExp) {
  await db.exec("savepoint rejected");
  await expect(rpc(name, args)).rejects.toThrow(message);
  await db.exec("rollback to savepoint rejected");
}
const items = (full = 40, empty = 30, cartons = 0) =>
  JSON.stringify([
    { product_id: jar, full_jars: full, empty_jars: empty, cartons },
  ]);
const counts = (full = 20, empty = 65, cartons = 10) =>
  JSON.stringify([
    { product_id: jar, stock_kind: "FULL_JAR", quantity: full },
    { product_id: jar, stock_kind: "EMPTY_JAR", quantity: empty },
    { product_id: carton, stock_kind: "BOTTLE_CARTON", quantity: cartons },
  ]);
async function load() {
  await rpc("load_trip", [
    trip,
    JSON.stringify([
      { product_id: jar, stock_kind: "FULL_JAR", quantity: 100 },
      { product_id: carton, stock_kind: "BOTTLE_CARTON", quantity: 10 },
    ]),
    randomUUID(),
  ]);
}
async function visit(
  full = 40,
  empty = 30,
  key = randomUUID(),
  payment = { selection: "CASH" },
) {
  return rpc("post_trip_visit", [
    trip,
    customer,
    "",
    "",
    items(full, empty),
    JSON.stringify(payment),
    "",
    key,
  ]);
}
async function active() {
  await load();
  await who(driver);
  await rpc("transition_trip", [trip, "START", "", randomUUID()]);
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth;
 create table auth.users(id uuid primary key,email text);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;`);
  for (const file of readdirSync("supabase/migrations").sort())
    await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
  await db.query("insert into auth.users(id) values($1),($2),($3)", [
    admin,
    driver,
    other,
  ]);
  await db.query(
    "insert into public.profiles(id,name,role) values($1,'Admin','ADMIN'),($2,'Driver','DRIVER'),($3,'Other','DRIVER')",
    [admin, driver, other],
  );
}, 30000);
afterAll(async () => {
  await db?.close();
});
beforeEach(async () => {
  await db.exec("begin");
  await who(admin);
  for (const [id, kind] of [
    [jar, "FULL_JAR"],
    [carton, "BOTTLE_CARTON"],
  ])
    await rpc("save_product", [
      id,
      kind,
      kind,
      kind,
      "unit",
      "150.25",
      true,
      0,
      "Test setup",
      randomUUID(),
    ]);
  day = await rpc("open_inventory_business_day", [randomUUID()]);
  await rpc("adjust_warehouse_stock", [
    jar,
    "FULL_JAR",
    100,
    "Isolated test setup",
    "",
    day,
    randomUUID(),
  ]);
  await rpc("adjust_warehouse_stock", [
    carton,
    "BOTTLE_CARTON",
    10,
    "Isolated test setup",
    "",
    day,
    randomUUID(),
  ]);
  await rpc("save_customer", [
    customer,
    "Customer",
    "Shop",
    "123",
    "Address",
    "",
    true,
    0,
    "Test setup",
    randomUUID(),
  ]);
  await rpc("save_vehicle", [
    vehicle,
    "TEST-001",
    "",
    true,
    0,
    "Test setup",
    randomUUID(),
  ]);
  await rpc("create_trip", [
    trip,
    driver,
    vehicle,
    day,
    "[]",
    "",
    randomUUID(),
  ]);
});
afterEach(async () => {
  await db.exec("rollback; reset role");
});
async function finance(
  operation: string,
  data: Record<string, unknown>,
  key = randomUUID(),
) {
  return rpc("finance_command", [operation, JSON.stringify(data), key]);
}
async function workspace() {
  return (await scalar(
    "select public.finance_workspace()",
  )) as import("@/domain/finance/types").FinanceWorkspace;
}
async function invoice() {
  return (await workspace()).invoices[0]!;
}
async function post(
  selection = "UNPAID",
  amount?: string,
  extra: Record<string, unknown> = {},
) {
  return rpc("post_trip_visit", [
    trip,
    customer,
    "",
    "",
    items(10, 0),
    JSON.stringify({ selection, reported_amount: amount ?? null, ...extra }),
    "",
    randomUUID(),
  ]);
}
async function collection(
  amount: string,
  invoiceId: string,
  method = "CASH",
  key = randomUUID(),
) {
  return finance(
    "PAYMENT",
    {
      trip,
      customer,
      method,
      amount,
      allocations: [{ invoice_id: invoiceId, amount }],
    },
    key,
  );
}
it("cash, credit and partial settle exact totals without floating point", async () => {
  await active();
  await post("CASH");
  let w = await workspace();
  expect(w.invoices[0]!.total).toBe("1502.50");
  expect(w.invoices[0]!.outstanding).toBe("0.00");
  await post("PARTIAL", "500.25");
  await post();
  w = await workspace();
  expect(w.invoices.map((i) => i.outstanding).sort()).toEqual([
    "0.00",
    "1002.25",
    "1502.50",
  ]);
  await who(admin);
  w = await workspace();
  expect(
    w.ledger.reduce((sum, l) => sum + Math.round(Number(l.amount) * 100), 0),
  ).toBe(250475);
});
it("pending Fonepay reserves balance but never reduces credit until explicit admin reconciliation", async () => {
  await active();
  await post("FONEPAY");
  let w = await workspace();
  const p = w.payments[0]!;
  expect(p.status).toBe("PENDING");
  expect(w.invoices[0]!.outstanding).toBe("1502.50");
  expect(w.invoices[0]!.available).toBe("0.00");
  await rejects(
    "finance_command",
    [
      "VERIFY",
      JSON.stringify({
        payment: p.id,
        decision: "CONFIRM",
        day,
        reference: "ref-1",
        reason: "Bank statement matched",
      }),
      randomUUID(),
    ],
    /authorized/,
  );
  await who(admin);
  await finance("VERIFY", {
    payment: p.id,
    decision: "CONFIRM",
    day,
    reference: "ref-1",
    reason: "Matched official merchant statement",
  });
  w = await workspace();
  expect(w.payments[0]!.status).toBe("CONFIRMED");
  expect(w.invoices[0]!.outstanding).toBe("0.00");
  expect(w.events.at(-1)!.source).toBe("ADMIN_MANUAL");
});
it("rejecting Fonepay releases reservation and allows another receipt", async () => {
  await active();
  await post("FONEPAY");
  let w = await workspace();
  await who(admin);
  await finance("VERIFY", {
    payment: w.payments[0]!.id,
    decision: "REJECT",
    day,
    reason: "No settlement on statement",
  });
  await who(driver);
  await collection("1502.50", w.invoices[0]!.id);
  w = await workspace();
  expect(w.invoices[0]!.outstanding).toBe("0.00");
});
it("approved customer price applies and historical prices survive catalog changes", async () => {
  await finance("PRICE", {
    customer,
    product: jar,
    price: "99.99",
    active: true,
    version: 0,
    reason: "Approved negotiated rate",
  });
  await active();
  await post();
  expect((await workspace()).items[0]!.unit_price).toBe("99.99");
  await who(admin);
  await rpc("save_product", [
    jar,
    "FULL_JAR",
    "New jar name",
    "FULL_JAR",
    "unit",
    "200.00",
    true,
    1,
    "Price revision",
    randomUUID(),
  ]);
  expect((await workspace()).items[0]!.unit_price).toBe("99.99");
  expect((await invoice()).total).toBe("999.90");
});
it("deposit receipt, custody and refund are separate from revenue and credit", async () => {
  await finance("BILLING", {
    customer,
    account_type: "MONTHLY_CREDIT",
    deposit_mode: "MANUAL",
    due_days: 30,
    version: 0,
    reason: "Confirmed manual deposit arrangement",
  });
  await active();
  await post("CASH", undefined, {
    payments: [
      {
        method: "CASH",
        amount: "2002.50",
        current_amount: "1502.50",
        deposit_amount: "500.00",
      },
    ],
  });
  let w = await workspace();
  expect(w.invoices[0]!.total).toBe("1502.50");
  expect(w.deposits[0]!.amount).toBe("500.00");
  expect(w.invoices[0]!.outstanding).toBe("0.00");
  expect(await scalar("select quantity from public.jar_custody_balances")).toBe(
    10,
  );
  await visit(0, 5, randomUUID(), { selection: "UNPAID" });
  w = await workspace();
  expect(w.deposits).toHaveLength(1);
  expect(await scalar("select quantity from public.jar_custody_balances")).toBe(
    5,
  );
  await who(admin);
  await finance("REFUND", {
    customer,
    amount: "200",
    day,
    reason: "Explicit customer refund approval",
  });
  w = await workspace();
  expect(w.deposits.map((d) => d.amount)).toEqual(["500.00", "-200.00"]);
});
it("unconfigured deposit receipt fails and rolls back physical movements, invoice and journals", async () => {
  await active();
  const before = await scalar("select count(*) from public.stock_movements");
  await rejects(
    "post_trip_visit",
    [
      trip,
      customer,
      "",
      "",
      items(10, 0),
      JSON.stringify({
        selection: "CASH",
        payments: [
          {
            method: "CASH",
            amount: "2002.50",
            current_amount: "1502.50",
            deposit_amount: "500",
          },
        ],
      }),
      "",
      randomUUID(),
    ],
    /configure/,
  );
  expect((await workspace()).invoices).toHaveLength(0);
  expect(await scalar("select count(*) from public.stock_movements")).toBe(
    before,
  );
  expect(await scalar("select count(*) from public.jar_custody_balances")).toBe(
    0,
  );
});
it("duplicate payment retry cannot duplicate collections and changed payload cannot reuse key", async () => {
  await active();
  await post();
  const i = await invoice(),
    key = randomUUID();
  const first = await collection("500", i.id, "CASH", key);
  expect(await collection("500", i.id, "CASH", key)).toBe(first);
  expect((await workspace()).payments).toHaveLength(1);
  await rejects(
    "finance_command",
    [
      "PAYMENT",
      JSON.stringify({
        trip,
        customer,
        method: "CASH",
        amount: "501",
        allocations: [{ invoice_id: i.id, amount: "501" }],
      }),
      key,
    ],
    /different|reuse|already/i,
  );
});
it("over-allocation, excessive precision and unsettled credit adjustment fail atomically", async () => {
  await active();
  await post();
  const i = await invoice();
  await collection("500", i.id);
  for (const amount of ["1002.51", "0.001", "-1"])
    await rejects(
      "finance_command",
      [
        "PAYMENT",
        JSON.stringify({
          trip,
          customer,
          method: "CASH",
          amount,
          allocations: [{ invoice_id: i.id, amount }],
        }),
        randomUUID(),
      ],
      /balance|decimals/,
    );
  await who(admin);
  await rejects(
    "finance_command",
    [
      "ADJUST",
      JSON.stringify({
        invoice: i.id,
        day,
        direction: "CREDIT",
        subtotal_amount: "1502.50",
        tax_amount: "0",
        reason: "Correction",
      }),
      randomUUID(),
    ],
    /reverse receipts/,
  );
  expect((await workspace()).payments).toHaveLength(1);
});
it("audited receipt reversal and invoice adjustment preserve original immutable records", async () => {
  await active();
  await post("CASH");
  let w = await workspace();
  await who(admin);
  await finance("REVERSE", {
    payment: w.payments[0]!.id,
    day,
    reason: "Cash entry was recorded in error",
  });
  await finance("ADJUST", {
    invoice: w.invoices[0]!.id,
    day,
    direction: "CREDIT",
    subtotal_amount: "2.50",
    tax_amount: "0",
    reason: "Approved price correction",
  });
  w = await workspace();
  expect(w.payments[0]!.status).toBe("REVERSED");
  expect(w.invoices[0]!.total).toBe("1502.50");
  expect(w.invoices[0]!.outstanding).toBe("1500.00");
  expect(w.adjustments).toHaveLength(1);
  expect(
    w.journal.reduce((s, l) => s + Math.round(Number(l.amount) * 100), 0),
  ).toBe(0);
});
it("drivers cannot mutate settled records, refund deposits or read another route finance", async () => {
  await active();
  await post("CASH");
  const w = await workspace();
  await rejects(
    "finance_command",
    [
      "REVERSE",
      JSON.stringify({ payment: w.payments[0]!.id, day, reason: "Forbidden" }),
      randomUUID(),
    ],
    /authorized/,
  );
  await db.exec("savepoint denied");
  await expect(db.exec("update public.payments set amount=1")).rejects.toThrow(
    /permission denied/,
  );
  await db.exec("rollback to savepoint denied");
  await who(other);
  const hidden = await workspace();
  expect(hidden.invoices).toHaveLength(0);
  expect(hidden.payments).toHaveLength(0);
  expect(hidden.credit).toHaveLength(0);
  await rejects("finance_credit", [customer], /outside/);
});
it("customer outstanding persists across sessions and deactivation for admin history", async () => {
  await active();
  await post();
  await who(other);
  await who(driver);
  expect((await invoice()).outstanding).toBe("1502.50");
  await who(admin);
  await rpc("save_customer", [
    customer,
    "Customer",
    "Shop",
    "123",
    "Address",
    "",
    false,
    1,
    "Account retired",
    randomUUID(),
  ]);
  expect((await workspace()).credit[0]!.outstanding).toBe("1502.50");
});
it("old credit can be recovered on a new day/trip without increasing sales", async () => {
  await active();
  await post();
  const old = await invoice();
  await rpc("submit_trip", [trip, counts(90, 0, 10), randomUUID()]);
  await who(admin);
  await rpc("reconcile_trip", [
    trip,
    counts(90, 0, 10),
    "Counts verified",
    false,
    randomUUID(),
  ]);
  await db.exec("reset role");
  await db.query(
    "update public.business_days set status='CLOSED',closed_at=now(),closed_by=$1 where id=$2",
    [admin, day],
  );
  await who(admin);
  const newDay = await rpc("open_inventory_business_day", [randomUUID()]),
    newTrip = randomUUID();
  await rpc("create_trip", [
    newTrip,
    driver,
    vehicle,
    newDay,
    "[]",
    "",
    randomUUID(),
  ]);
  await rpc("load_trip", [
    newTrip,
    JSON.stringify([{ product_id: jar, stock_kind: "FULL_JAR", quantity: 10 }]),
    randomUUID(),
  ]);
  await who(driver);
  await rpc("transition_trip", [newTrip, "START", "", randomUUID()]);
  await finance("PAYMENT", {
    trip: newTrip,
    customer,
    method: "CASH",
    amount: "502.50",
    allocations: [{ invoice_id: old.id, amount: "502.50" }],
  });
  const w = await workspace();
  expect(w.sales.filter((s) => s.business_day_id === newDay)).toHaveLength(0);
  expect(w.payments[0]!.business_day_id).toBe(newDay);
  expect(w.credit[0]!.outstanding).toBe("1000.00");
});
it("tax and company configuration are explicit, snapshotted and exact", async () => {
  await finance("COMPANY", {
    version: 1,
    name: "Mount Kailash",
    address: "Kathmandu",
    phone: "",
    registration: "",
    tax_mode: "EXPLICIT",
    tax_label: "Confirmed test tax",
    tax_rate: "13",
    reason: "Isolated test configuration",
  });
  await active();
  await post();
  let w = await workspace();
  expect(w.invoices[0]!.tax).toBe("195.33");
  expect(w.invoices[0]!.total).toBe("1697.83");
  await who(admin);
  await finance("COMPANY", {
    version: 2,
    name: "Renamed",
    address: "",
    phone: "",
    registration: "",
    tax_mode: "UNCONFIGURED",
    tax_label: "",
    tax_rate: "0",
    reason: "Configuration correction",
  });
  w = await workspace();
  expect(w.invoices[0]!.company.name).toBe("Mount Kailash");
  expect(w.invoices[0]!.tax).toBe("195.33");
});
it("multiple mixed receipts settle an invoice; duplicate provider references cannot confirm twice", async () => {
  await active();
  await post();
  const i = await invoice();
  await collection("500", i.id);
  const p = await collection("1002.50", i.id, "FONEPAY");
  await who(admin);
  await finance("VERIFY", {
    payment: p,
    day,
    decision: "CONFIRM",
    reference: "merchant-unique",
    reason: "Merchant statement matched",
  });
  await who(driver);
  await post("FONEPAY");
  const q = (await workspace()).payments.find((p) => p.status === "PENDING")!;
  await who(admin);
  await rejects(
    "finance_command",
    [
      "VERIFY",
      JSON.stringify({
        payment: q.id,
        day,
        decision: "CONFIRM",
        reference: "merchant-unique",
        reason: "Duplicate statement",
      }),
      randomUUID(),
    ],
    /unique/,
  );
  expect((await workspace()).payments.find((x) => x.id === q.id)!.status).toBe(
    "PENDING",
  );
});
it("walk-ins cannot leave unallocated credit or custody", async () => {
  await active();
  await rejects(
    "post_trip_visit",
    [
      trip,
      null,
      "Walk in",
      "",
      items(2, 2),
      JSON.stringify({
        selection: "CASH",
        payments: [{ method: "CASH", amount: "100", current_amount: "100" }],
      }),
      "",
      randomUUID(),
    ],
    /fully covered/,
  );
  expect((await workspace()).invoices).toHaveLength(0);
});
it("exported PDF matches stored item prices, payment status and outstanding balance", async () => {
  await active();
  await post("PARTIAL", "500.25");
  await who(admin);
  const f = await workspace(),
    i = f.invoices[0]!;
  const bytes = await receiptPdf(invoiceDocument(i, f));
  const task = getDocument({ data: bytes, useSystemFonts: false });
  const pdf = await task.promise;
  const content = await (await pdf.getPage(1)).getTextContent();
  const text = content.items
    .map((item) => ("str" in item ? item.str : ""))
    .join(" ");
  expect(text).toContain("150.25");
  expect(text).toContain("1,502.50");
  expect(text).toContain("500.25");
  expect(text).toContain("1,002.25");
  expect(text).toContain("UNCONFIGURED");
  expect(text).toContain("Cash recorded");
  await task.destroy();
});
it("reports separate sales, old-credit recovery, pending receipts and deposits", async () => {
  await finance("BILLING", {
    customer,
    account_type: "MONTHLY_CREDIT",
    deposit_mode: "MANUAL",
    due_days: 30,
    version: 0,
    reason: "Manual deposit arrangement",
  });
  await active();
  await post();
  const i = await invoice();
  await collection("500", i.id);
  await post("FONEPAY");
  await who(admin);
  const f = await workspace(),
    m = financeMetrics(f, day);
  expect(m.sales).toBe("3005.00");
  expect(m.collections).toBe("500.00");
  // Repaying an earlier invoice on this same business day is a collection,
  // but does not represent recovery of credit carried from a previous day.
  expect(m.recovered).toBe("0.00");
  expect(m.pending).toBe("1502.50");
  expect(m.outstanding).toBe("2505.00");
});
it("finance journals reject updates and truncate even for database owner", async () => {
  await active();
  await post("CASH");
  await db.exec("reset role");
  for (const sql of [
    "update public.invoices set subtotal=0",
    "delete from public.customer_ledger",
    "truncate public.finance_journal",
  ]) {
    await db.exec("savepoint immutable");
    await expect(db.exec(sql)).rejects.toThrow(
      /immutable|append.only|journal/i,
    );
    await db.exec("rollback to savepoint immutable");
  }
});
it("receipt snapshots preserve names and billing details after later changes", async () => {
  await active();
  await post("CASH");
  await who(admin);
  await rpc("save_customer", [
    customer,
    "Changed customer",
    "Shop",
    "456",
    "New address",
    "",
    true,
    1,
    "Name change",
    randomUUID(),
  ]);
  expect((await workspace()).payments[0]!.customer_snapshot.name).toBe(
    "Customer",
  );
});
it("new assigned driver can collect limited prior credit without reading the old trip or invoice", async () => {
  await active();
  await post();
  const old = await invoice();
  await who(admin);
  const secondVehicle = randomUUID(),
    secondTrip = randomUUID();
  await rpc("save_vehicle", [
    secondVehicle,
    "SECOND",
    "",
    true,
    0,
    "Test vehicle",
    randomUUID(),
  ]);
  await rpc("adjust_warehouse_stock", [
    jar,
    "FULL_JAR",
    10,
    "Test stock",
    "",
    day,
    randomUUID(),
  ]);
  await rpc("create_trip", [
    secondTrip,
    other,
    secondVehicle,
    day,
    "[]",
    "",
    randomUUID(),
  ]);
  await rpc("load_trip", [
    secondTrip,
    JSON.stringify([{ product_id: jar, stock_kind: "FULL_JAR", quantity: 10 }]),
    randomUUID(),
  ]);
  await who(other);
  await rpc("transition_trip", [secondTrip, "START", "", randomUUID()]);
  let f = await workspace();
  expect(f.credit).toHaveLength(0);
  const context = (await rpc("delivery_customer_context", [
    secondTrip,
    customer,
  ])) as unknown as DeliveryCustomerContext;
  expect(context.credit[0]!.id).toBe(old.id);
  expect(f.invoices).toHaveLength(0);
  expect(f.sales).toHaveLength(0);
  expect(context.credit[0]).not.toHaveProperty("trip_id");
  expect(await scalar("select count(*) from public.invoices")).toBe(0);
  await finance("PAYMENT", {
    trip: secondTrip,
    customer,
    method: "CASH",
    amount: "100",
    allocations: [{ invoice_id: old.id, amount: "100" }],
  });
  f = await workspace();
  expect(f.invoices).toHaveLength(0);
  expect(f.credit[0]!.outstanding).toBe("1402.50");
});
// Font embedding plus PDF parsing is CPU-heavy when browser builds share the host.
it("Nepali receipt text and long item names export without clipped pages", async () => {
  await who(admin);
  await rpc("save_customer", [
    customer,
    "कैलाश पानी",
    "Shop",
    "123",
    "काठमाडौं",
    "",
    true,
    1,
    "Nepali test customer",
    randomUUID(),
  ]);
  await active();
  await post();
  const f = await workspace(),
    document = invoiceDocument(f.invoices[0]!, f);
  document.lines.push(
    ...Array.from(
      { length: 60 },
      (_, i) => `Line ${i}: ${"long product name ".repeat(12)}`,
    ),
  );
  const task = getDocument({
      data: await receiptPdf(document),
      useSystemFonts: false,
    }),
    pdf = await task.promise;
  expect(pdf.numPages).toBeGreaterThan(1);
  const c = await (await pdf.getPage(1)).getTextContent();
  expect(c.items.map((i) => ("str" in i ? i.str : "")).join(" ")).toContain(
    "कैलाश",
  );
  await task.destroy();
}, 30000);
it("rejected walk-in Fonepay can be replaced on the same assigned active trip", async () => {
  await active();
  await rpc("post_trip_visit", [
    trip,
    null,
    "Walk in",
    "",
    items(2, 2),
    JSON.stringify({ selection: "FONEPAY" }),
    "",
    randomUUID(),
  ]);
  let f = await workspace();
  const i = f.invoices[0]!,
    p = f.payments[0]!;
  await who(admin);
  await finance("VERIFY", {
    payment: p.id,
    day,
    decision: "REJECT",
    reason: "No merchant settlement",
  });
  await who(driver);
  await finance("PAYMENT", {
    trip,
    customer: null,
    invoice: i.id,
    method: "CASH",
    amount: i.total,
    current_amount: i.total,
    allocations: [],
  });
  f = await workspace();
  expect(f.invoices[0]!.outstanding).toBe("0.00");
  expect(f.sales).toHaveLength(1);
});

function driverDelivery(
  status = "PAID",
  amount: string | null = "1502.50",
  key = randomUUID(),
  registered: string | null = customer,
  full = 10,
  empty = 0,
) {
  return [
    trip,
    registered,
    "Walk-in",
    "",
    items(full, empty),
    status,
    amount,
    "",
    key,
  ];
}
it("simplified Paid settles the actual invoice once and persists its stock and financial journals", async () => {
  await active();
  const args = driverDelivery();
  const id = await rpc("post_driver_delivery", args);
  const w = await workspace();
  expect(w.invoices[0]!.total).toBe("1502.50");
  expect(w.invoices[0]!.outstanding).toBe("0.00");
  expect(w.payments).toHaveLength(1);
  expect(w.payments[0]).toMatchObject({
    method: "CASH",
    status: "CONFIRMED",
    amount: "1502.50",
  });
  expect(await rpc("post_driver_delivery", args)).toBe(id);
  expect(await workspace()).toEqual(w);
  expect(await scalar("select count(*) from public.trip_visits")).toBe(1);
});
it.each([null, "1502.49", "1502.51"])(
  "incorrect Paid amount %s rolls back the whole delivery",
  async (amount) => {
    await active();
    const before = await scalar("select public.operations_workspace($1)", [
      trip,
    ]);
    const money = await workspace();
    const key = randomUUID();
    await rejects(
      "post_driver_delivery",
      driverDelivery("PAID", amount, key),
      /received|amount|allocation|payable|invoice balance/i,
    );
    expect(
      await scalar("select public.operations_workspace($1)", [trip]),
    ).toEqual(before);
    expect(await workspace()).toEqual(money);
    // Failed validation must not consume the retry key.
    await rpc("post_driver_delivery", driverDelivery("PAID", "1502.50", key));
    expect((await workspace()).invoices).toHaveLength(1);
  },
);
it("simplified Credit posts the full customer debt and no receipt; empty returns preserve finance", async () => {
  await active();
  await rpc("post_driver_delivery", driverDelivery("CREDIT", null));
  const w = await workspace();
  expect(w.invoices[0]!.outstanding).toBe("1502.50");
  expect(w.credit[0]!.outstanding).toBe("1502.50");
  expect(w.payments).toHaveLength(0);
  await rpc(
    "post_driver_delivery",
    driverDelivery("RETURN_ONLY", null, randomUUID(), customer, 0, 5),
  );
  expect(await workspace()).toEqual(w);
  expect(await scalar("select count(*) from public.trip_visits")).toBe(2);
});
it("simplified Credit rejects walk-ins, new receipts and forged return-only sales", async () => {
  await active();
  await rejects(
    "post_driver_delivery",
    driverDelivery("CREDIT", null, randomUUID(), null),
    /registered customer/,
  );
  await rejects(
    "post_driver_delivery",
    driverDelivery("CREDIT", "1"),
    /cannot collect/,
  );
  await rejects(
    "post_driver_delivery",
    driverDelivery("RETURN_ONLY", null),
    /status does not match/,
  );
  expect((await workspace()).invoices).toHaveLength(0);
});
it("simplified delivery respects trip ownership and authenticated-only grants", async () => {
  await active();
  await who(other);
  await rejects(
    "post_driver_delivery",
    driverDelivery(),
    /assigned|permission|not authorized|own|access/i,
  );
  expect(
    await scalar(
      "select has_function_privilege('anon','public.post_driver_delivery(uuid,uuid,text,text,jsonb,text,text,text,uuid)','EXECUTE')",
    ),
  ).toBe(false);
  expect(
    await scalar(
      "select has_function_privilege('authenticated','public.post_driver_delivery(uuid,uuid,text,text,jsonb,text,text,text,uuid)','EXECUTE')",
    ),
  ).toBe(true);
});
it("Paid validates server prices rather than a stale form total", async () => {
  await finance("PRICE", {
    customer,
    product: jar,
    price: "99.99",
    active: true,
    version: 0,
    reason: "Approved negotiated rate",
  });
  await active();
  await rejects(
    "post_driver_delivery",
    driverDelivery(),
    /received|amount|allocation|payable|invoice balance/i,
  );
  await rpc("post_driver_delivery", driverDelivery("PAID", "999.90"));
  expect((await invoice()).outstanding).toBe("0.00");
});
it("Paid includes the server tax snapshot in its equality check", async () => {
  await finance("COMPANY", {
    version: 1,
    name: "Mount Kailash",
    address: "Kathmandu",
    phone: "",
    registration: "",
    tax_mode: "EXPLICIT",
    tax_label: "Confirmed test tax",
    tax_rate: "13",
    reason: "Isolated test configuration",
  });
  await active();
  await rejects("post_driver_delivery", driverDelivery(), /payable/);
  await rpc("post_driver_delivery", driverDelivery("PAID", "1697.83"));
  expect(await invoice()).toMatchObject({
    total: "1697.83",
    outstanding: "0.00",
    tax: "195.33",
  });
});
