import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, beforeEach, afterEach, it, expect } from "vitest";
import type { DayDetail, HistoryDay } from "@/domain/business-days/types";
import {
  dailyDocument,
  dailyCsv,
  groupedTrips,
} from "@/domain/business-days/reports";
import { receiptPdf } from "@/services/pdf";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
let db: PGlite, day: string;
const admin = randomUUID(),
  driver = randomUUID(),
  other = randomUUID(),
  jar = randomUUID(),
  carton = randomUUID(),
  customer = randomUUID(),
  vehicle = randomUUID();
async function who(id = admin) {
  await db.exec("reset role;set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
}
async function rpc<T = string>(name: string, args: unknown[]) {
  return (
    await db.query<{ value: T }>(
      `select public.${name}(${args.map((_, i) => `$${i + 1}`).join(",")}) as value`,
      args,
    )
  ).rows[0]!.value;
}
async function value(sql: string, args: unknown[] = []) {
  return Object.values((await db.query(sql, args)).rows[0]!)[0];
}
async function rejects(name: string, args: unknown[], match: RegExp) {
  await db.exec("savepoint rejected");
  await expect(rpc(name, args)).rejects.toThrow(match);
  await db.exec("rollback to savepoint rejected");
}
const detail = (id = day) => rpc<DayDetail>("business_day_report", [id]);
const command = (
  operation: string,
  data: Record<string, unknown>,
  key = randomUUID(),
  id = day,
) => rpc("business_day_command", [operation, id, JSON.stringify(data), key]);
const closeData = (version: number, cash = "0.00") => ({
  version,
  cash_counted: cash,
  notes:
    "Physical counts and merchant records checked in disposable PostgreSQL",
  cash_checked: true,
  fonepay_checked: true,
  stock_checked: true,
  balances_checked: true,
  confirmed: true,
});
async function close(cash = "0.00") {
  const version = (await detail()).report.day.version;
  await command("REVIEW", { version });
  return command("CLOSE", closeData(version + 1, cash));
}
async function newTrip(load = 100) {
  const trip = randomUUID();
  await rpc("create_trip", [
    trip,
    driver,
    vehicle,
    day,
    JSON.stringify([customer]),
    "",
    randomUUID(),
  ]);
  if (load > 0) {
    await rpc("load_trip", [
      trip,
      JSON.stringify([
        { product_id: jar, stock_kind: "FULL_JAR", quantity: load },
      ]),
      randomUUID(),
    ]);
    await who(driver);
    await rpc("transition_trip", [trip, "START", "", randomUUID()]);
  }
  return trip;
}
async function visit(
  trip: string,
  full = 80,
  empty = 65,
  payment: Record<string, unknown> = { selection: "UNPAID" },
) {
  return rpc("post_trip_visit", [
    trip,
    customer,
    "",
    "",
    JSON.stringify([
      { product_id: jar, full_jars: full, empty_jars: empty, cartons: 0 },
    ]),
    JSON.stringify(payment),
    "",
    randomUUID(),
  ]);
}
async function reconcile(trip: string, full = 20, empty = 65) {
  const counts = JSON.stringify([
    { product_id: jar, stock_kind: "FULL_JAR", quantity: full },
    { product_id: jar, stock_kind: "EMPTY_JAR", quantity: empty },
  ]);
  await who(driver);
  await rpc("submit_trip", [trip, counts, randomUUID()]);
  await who();
  return rpc("reconcile_trip", [
    trip,
    counts,
    "Physical returns counted",
    false,
    randomUUID(),
  ]);
}
async function cycle(
  payment: Record<string, unknown> = { selection: "UNPAID" },
) {
  const trip = await newTrip();
  await visit(trip, 80, 65, payment);
  await reconcile(trip);
  return trip;
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,email text);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;`);
  for (const f of readdirSync("supabase/migrations").sort())
    await db.exec(readFileSync(`supabase/migrations/${f}`, "utf8"));
  await db.query("insert into auth.users(id) values($1),($2),($3)", [
    admin,
    driver,
    other,
  ]);
  await db.query(
    "insert into public.profiles(id,name,role) values($1,'Warehouse admin','ADMIN'),($2,'Delivery driver','DRIVER'),($3,'Other driver','DRIVER')",
    [admin, driver, other],
  );
}, 30000);
it("null or string confirmation flags cannot bypass PostgreSQL close validation", async () => {
  await command("REVIEW", { version: 1 });
  for (const confirmed of [null, "true", false])
    await rejects(
      "business_day_command",
      [
        "CLOSE",
        day,
        JSON.stringify({ ...closeData(2), confirmed }),
        randomUUID(),
      ],
      /Explicitly/,
    );
  expect((await detail()).report.day.status).toBe("CLOSING_REVIEW");
  expect(await value("select count(*) from public.business_day_closings")).toBe(
    0,
  );
});
it("an unbalanced persisted posting gives a critical finance blocker", async () => {
  await db.exec("reset role");
  await db.query(
    "insert into public.finance_journal(posting_id,source_id,kind,account,amount,business_day_id,actor_user_id) values($1,$2,'TEST_INCOMPLETE','CASH',1,$3,$4)",
    [randomUUID(), randomUUID(), day, admin],
  );
  await who();
  expect((await detail()).blockers.some((b) => b.code === "JOURNAL")).toBe(
    true,
  );
  await rejects(
    "business_day_command",
    ["REVIEW", day, JSON.stringify({ version: 1 }), randomUUID()],
    /blocked/,
  );
});
it("a later refund reports cash outflow separately from collections and carries the remaining deposit", async () => {
  await rpc("finance_command", [
    "BILLING",
    JSON.stringify({
      customer,
      account_type: "STANDARD",
      deposit_mode: "MANUAL",
      version: 0,
      reason: "Manual deposit arrangement",
    }),
    randomUUID(),
  ]);
  await cycle({
    selection: "PARTIAL",
    payments: [
      {
        method: "CASH",
        amount: "600",
        current_amount: "100",
        deposit_amount: "500",
        allocations: [],
      },
    ],
  });
  await close("600");
  const oldDay = day,
    old = (await detail()).report;
  day = await rpc("open_inventory_business_day", [randomUUID()]);
  await rpc("finance_command", [
    "REFUND",
    JSON.stringify({
      customer,
      day,
      amount: "100",
      reason: "Actual cash refund recorded",
    }),
    randomUUID(),
  ]);
  expect((await detail()).report.totals).toMatchObject({
    sales: "0",
    collections: "0",
    cash_net: "-100.00",
    deposits_refunded: "100.00",
    deposit_liability: "400.00",
    outstanding: "11920.00",
  });
  await close("-100");
  expect((await detail(oldDay)).report).toEqual(old);
});
it("post-close receipt reversal changes current collections and creates a linked amendment without changing the original archive", async () => {
  await cycle({ selection: "CASH" });
  const payment = (await detail()).report.payments[0]!.id;
  await close("12020");
  const oldDay = day,
    old = (await detail()).report;
  day = await rpc("open_inventory_business_day", [randomUUID()]);
  await rpc("finance_command", [
    "REVERSE",
    JSON.stringify({
      payment,
      day,
      reason: "Documented correction to prior receipt",
    }),
    randomUUID(),
  ]);
  const history = await detail(oldDay);
  expect(history.report).toEqual(old);
  expect(history.amendments).toHaveLength(1);
  expect(history.amendments[0]!.source_kind).toBe("PAYMENT_REVERSAL");
  expect((await detail()).report.totals).toMatchObject({
    sales: "0",
    collections: "-12020.00",
    outstanding: "12020.00",
  });
  await close("-12020");
});
it("unapproved stock discrepancy blocks closing and a separate authorized resolution remains auditable", async () => {
  const trip = await newTrip();
  await visit(trip);
  const declared = JSON.stringify([
    { product_id: jar, stock_kind: "FULL_JAR", quantity: 20 },
    { product_id: jar, stock_kind: "EMPTY_JAR", quantity: 65 },
  ]);
  await rpc("submit_trip", [trip, declared, randomUUID()]);
  await who();
  const actual = JSON.stringify([
    { product_id: jar, stock_kind: "FULL_JAR", quantity: 19 },
    { product_id: jar, stock_kind: "EMPTY_JAR", quantity: 65 },
  ]);
  await rpc("reconcile_trip", [
    trip,
    actual,
    "One jar missing; investigating",
    false,
    randomUUID(),
  ]);
  expect(
    (await detail()).blockers.some((b) => b.message.includes("DISCREPANCY")),
  ).toBe(true);
  await rejects(
    "business_day_command",
    ["REVIEW", day, JSON.stringify({ version: 1 }), randomUUID()],
    /blocked/,
  );
  await rpc("reconcile_trip", [
    trip,
    actual,
    "Authorized documented missing jar",
    true,
    randomUUID(),
  ]);
  const r = (await detail()).report;
  expect((await detail()).blockers).toHaveLength(0);
  expect(r.discrepancies).toHaveLength(2);
  expect(r.discrepancies.some((d) => d.approved_by === admin)).toBe(true);
  expect(r.movements.some((m) => m.movement_type === "VARIANCE_LOSS")).toBe(
    true,
  );
  await close();
});
it("refilling all 65 accepted empties preserves physical jar counts and yields 85 full warehouse jars", async () => {
  await cycle();
  await rpc("process_warehouse_jars", [
    day,
    jar,
    "REFILL",
    "EMPTY_JAR",
    65,
    "Completed inspected refill",
    randomUUID(),
  ]);
  const r = (await detail()).report;
  expect(
    r.stock.find(
      (s) => s.location_kind === "WAREHOUSE" && s.stock_kind === "FULL_JAR",
    )!.closing,
  ).toBe(85);
  expect(
    r.stock.find(
      (s) => s.location_kind === "WAREHOUSE" && s.stock_kind === "EMPTY_JAR",
    )!.closing,
  ).toBe(0);
  expect(r.custody[0]!.quantity).toBe(15);
  await close();
});
it("carton sales, returns and closing stock are included in product and daily totals", async () => {
  const t = await newTrip(0);
  await rpc("load_trip", [
    t,
    JSON.stringify([
      { product_id: jar, stock_kind: "FULL_JAR", quantity: 100 },
      { product_id: carton, stock_kind: "BOTTLE_CARTON", quantity: 10 },
    ]),
    randomUUID(),
  ]);
  await who(driver);
  await rpc("transition_trip", [t, "START", "", randomUUID()]);
  await rpc("post_trip_visit", [
    t,
    customer,
    "",
    "",
    JSON.stringify([
      { product_id: jar, full_jars: 80, empty_jars: 65, cartons: 0 },
      { product_id: carton, full_jars: 0, empty_jars: 0, cartons: 3 },
    ]),
    JSON.stringify({ selection: "UNPAID" }),
    "",
    randomUUID(),
  ]);
  const counts = JSON.stringify([
    { product_id: jar, stock_kind: "FULL_JAR", quantity: 20 },
    { product_id: jar, stock_kind: "EMPTY_JAR", quantity: 65 },
    { product_id: carton, stock_kind: "BOTTLE_CARTON", quantity: 7 },
  ]);
  await rpc("submit_trip", [t, counts, randomUUID()]);
  await who();
  await rpc("reconcile_trip", [
    t,
    counts,
    "Confirmed jar and carton returns",
    false,
    randomUUID(),
  ]);
  await close();
  const r = (await detail()).report;
  expect(r.totals).toMatchObject({
    full_jars: 80,
    empty_jars: 65,
    cartons: 3,
    sales: "12470.75",
  });
  expect(r.stock.find((s) => s.stock_kind === "BOTTLE_CARTON")!.closing).toBe(
    7,
  );
  expect(r.products.find((p) => p.product_id === carton)!.cartons).toBe(3);
});
afterAll(async () => {
  await db?.close();
});
beforeEach(async () => {
  await db.exec("begin");
  await who();
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
      "Disposable fixture",
      randomUUID(),
    ]);
  day = await rpc("open_inventory_business_day", [randomUUID()]);
  await rpc("adjust_warehouse_stock", [
    jar,
    "FULL_JAR",
    100,
    "Disposable fixture",
    "",
    day,
    randomUUID(),
  ]);
  await rpc("adjust_warehouse_stock", [
    carton,
    "BOTTLE_CARTON",
    10,
    "Disposable fixture",
    "",
    day,
    randomUUID(),
  ]);
  await rpc("save_customer", [
    customer,
    "Customer",
    "Shop",
    "",
    "",
    "",
    true,
    0,
    "Disposable fixture",
    randomUUID(),
  ]);
  await rpc("save_vehicle", [
    vehicle,
    "TEST-CLOSE",
    "",
    true,
    0,
    "Disposable fixture",
    randomUUID(),
  ]);
});
afterEach(async () => {
  await db.exec("rollback;reset role");
});
it("admin opens the Nepal day without overlap or resetting inventory", async () => {
  const r = (await detail()).report;
  expect(r.day.status).toBe("OPEN");
  expect(r.stock.find((s) => s.stock_kind === "FULL_JAR")!.opening).toBe(0);
  expect(r.stock.find((s) => s.stock_kind === "FULL_JAR")!.closing).toBe(100);
  await rejects(
    "open_inventory_business_day",
    [randomUUID()],
    /already active/,
  );
});
it("driver and disabled admin cannot close, read global reports or process jars", async () => {
  await who(driver);
  await rejects(
    "business_day_command",
    ["REVIEW", day, JSON.stringify({ version: 1 }), randomUUID()],
    /authorized/,
  );
  await rejects("business_day_report", [day], /authorized/);
  await rejects("business_day_history", [null, null], /authorized/);
  await rejects(
    "process_warehouse_jars",
    [day, jar, "DAMAGE", "FULL_JAR", 1, "Inspection", randomUUID()],
    /authorized/,
  );
  expect(await value("select count(*) from public.business_day_closings")).toBe(
    0,
  );
  await db.exec("reset role");
  await db.query("update public.profiles set is_active=false where id=$1", [
    admin,
  ]);
  await who();
  await rejects(
    "business_day_command",
    ["REVIEW", day, JSON.stringify({ version: 1 }), randomUUID()],
    /authorized/,
  );
});
it("unfinished trips give actionable blockers and failed review leaves no archive or request", async () => {
  const trip = await newTrip(0),
    key = randomUUID();
  const blockers = (await detail()).blockers;
  expect(blockers.some((b) => b.href.endsWith(trip) && b.code === "TRIP")).toBe(
    true,
  );
  await rejects(
    "business_day_command",
    ["REVIEW", day, JSON.stringify({ version: 1 }), key],
    /blocked/,
  );
  expect((await detail()).report.day.status).toBe("OPEN");
  expect(await value("select count(*) from public.business_day_closings")).toBe(
    0,
  );
  await db.exec("reset role");
  expect(
    await value(
      "select count(*) from public.operation_requests where idempotency_key=$1",
      [key],
    ),
  ).toBe(0);
});
it("submitted trips block review until administrator reconciliation", async () => {
  const t = await newTrip();
  await visit(t);
  const counts = JSON.stringify([
    { product_id: jar, stock_kind: "FULL_JAR", quantity: 20 },
    { product_id: jar, stock_kind: "EMPTY_JAR", quantity: 65 },
  ]);
  await rpc("submit_trip", [t, counts, randomUUID()]);
  await who();
  expect(
    (await detail()).blockers.some((b) => b.message.includes("SUBMITTED")),
  ).toBe(true);
  await rpc("reconcile_trip", [
    t,
    counts,
    "Counted returns",
    false,
    randomUUID(),
  ]);
  expect((await detail()).blockers).toHaveLength(0);
  await close();
});
it("multiple trips on one day preserve 100/80/65 counts and archive actual facts", async () => {
  await cycle();
  const t2 = await newTrip(20);
  await visit(t2, 10, 0);
  await reconcile(t2, 10, 0);
  const r = (await detail()).report;
  expect(r.totals).toMatchObject({
    trips: 2,
    completed_trips: 2,
    full_jars: 90,
    empty_jars: 65,
    cartons: 0,
  });
  expect(r.trips.every((t) => t.status === "CLOSED")).toBe(true);
  expect(groupedTrips(r, "driver")[0]).toMatchObject({
    trips: 2,
    full_jars: 90,
    empty_jars: 65,
  });
  await close();
  const frozen = (await detail()).report;
  expect(frozen.source).toBe("ARCHIVED");
  expect(frozen.day.closed_by).toBe(admin);
  expect(new Date(frozen.day.closed_at!).getTime()).toBeGreaterThanOrEqual(
    new Date(frozen.day.opened_at).getTime(),
  );
});
it("refilling is one-for-one, damage is quarantined and duplicate requests never add jars", async () => {
  await cycle();
  const key = randomUUID();
  const args = [
    day,
    jar,
    "REFILL",
    "EMPTY_JAR",
    60,
    "Completed eligible refill",
    key,
  ];
  const id = await rpc("process_warehouse_jars", args);
  expect(await rpc("process_warehouse_jars", args)).toBe(id);
  await rpc("process_warehouse_jars", [
    day,
    jar,
    "DAMAGE",
    "EMPTY_JAR",
    5,
    "Rejected cracked jars",
    randomUUID(),
  ]);
  const r = (await detail()).report;
  expect(r.totals).toMatchObject({ refilled: 60, damaged: 5 });
  expect(
    r.stock.find(
      (s) => s.location_kind === "WAREHOUSE" && s.stock_kind === "FULL_JAR",
    )!.closing,
  ).toBe(80);
  expect(
    r.stock.find(
      (s) => s.location_kind === "WAREHOUSE" && s.stock_kind === "EMPTY_JAR",
    )!.closing,
  ).toBe(0);
  expect(r.stock.find((s) => s.location_kind === "DAMAGE")!.closing).toBe(5);
  expect((await detail()).blockers).toHaveLength(0);
  await rejects(
    "process_warehouse_jars",
    [day, jar, "REFILL", "EMPTY_JAR", 1, "No empties available", randomUUID()],
    /Insufficient/,
  );
  expect(r.processing).toHaveLength(2);
  expect(r.movements.filter((m) => m.processing_id)).toHaveLength(3);
});
it("processing failures roll back both movements, balances and history", async () => {
  const before = JSON.stringify((await detail()).report.stock);
  await rejects(
    "process_warehouse_jars",
    [day, jar, "DAMAGE", "FULL_JAR", 101, "Too many jars", randomUUID()],
    /Insufficient/,
  );
  expect(JSON.stringify((await detail()).report.stock)).toBe(before);
  expect((await detail()).report.processing).toHaveLength(0);
});
it("pending Fonepay is excluded and blocks closing until independently reconciled", async () => {
  await cycle({ selection: "FONEPAY" });
  let r = await detail();
  expect(r.report.totals.fonepay).toBe("0");
  expect(r.report.totals.pending_fonepay).toBe("12020.00");
  expect(r.blockers.some((b) => b.code === "FONEPAY")).toBe(true);
  const payment = r.report.payments[0]!;
  await rpc("finance_command", [
    "VERIFY",
    JSON.stringify({
      payment: payment.id,
      day,
      decision: "CONFIRM",
      reference: "MERCHANT-CLOSE-TEST",
      reason: "Independent merchant settlement confirmed",
    }),
    randomUUID(),
  ]);
  r = await detail();
  expect(r.blockers).toHaveLength(0);
  expect(r.report.totals.fonepay).toBe("12020.00");
  await close();
});
it("cash shortage and missing confirmations block close without partial state changes", async () => {
  await cycle({ selection: "CASH" });
  await command("REVIEW", { version: 1 });
  await rejects(
    "business_day_command",
    ["CLOSE", day, JSON.stringify(closeData(2, "1")), randomUUID()],
    /does not match/,
  );
  expect((await detail()).report.day.status).toBe("CLOSING_REVIEW");
  await rejects(
    "business_day_command",
    [
      "CLOSE",
      day,
      JSON.stringify({ ...closeData(2, "12020"), confirmed: false }),
      randomUUID(),
    ],
    /Explicitly/,
  );
  expect(await value("select count(*) from public.business_day_closings")).toBe(
    0,
  );
  await command("CLOSE", closeData(2, "12020"));
});
it("review freezes normal stock, custody, trip and finance writes; reasoned resume unfreezes", async () => {
  await command("REVIEW", { version: 1 });
  await rejects(
    "adjust_warehouse_stock",
    [jar, "FULL_JAR", 1, "Review blocked", "", day, randomUUID()],
    /OPEN/,
  );
  await rejects(
    "create_trip",
    [randomUUID(), driver, vehicle, day, "[]", "", randomUUID()],
    /OPEN/,
  );
  await rejects(
    "adjust_customer_custody",
    [customer, jar, 1, day, "Review blocked", randomUUID()],
    /OPEN/,
  );
  await rejects(
    "process_warehouse_jars",
    [day, jar, "DAMAGE", "FULL_JAR", 1, "Review blocked", randomUUID()],
    /OPEN/,
  );
  await rejects(
    "open_inventory_business_day",
    [randomUUID()],
    /already active/,
  );
  await command("RESUME", {
    version: 2,
    reason: "Recheck warehouse physical count",
  });
  expect((await detail()).report.day).toMatchObject({
    status: "OPEN",
    version: 3,
  });
});
it("close retries preserve one archive; stale or altered duplicate requests fail", async () => {
  await command("REVIEW", { version: 1 });
  const key = randomUUID(),
    data = closeData(2);
  await command("CLOSE", data, key);
  const before = JSON.stringify((await detail()).report);
  expect(await command("CLOSE", data, key)).toBe(day);
  expect(JSON.stringify((await detail()).report)).toBe(before);
  await rejects(
    "business_day_command",
    [
      "CLOSE",
      day,
      JSON.stringify({ ...data, notes: "Different content" }),
      key,
    ],
    /Idempotency/,
  );
  await rejects(
    "business_day_command",
    ["CLOSE", day, JSON.stringify(closeData(3)), randomUUID()],
    /already closed/,
  );
  expect(await value("select count(*) from public.business_day_closings")).toBe(
    1,
  );
});
it("stock, jar custody, credit and deposits carry; next-day sales, collections and trip counts start at zero", async () => {
  await rpc("finance_command", [
    "BILLING",
    JSON.stringify({
      customer,
      account_type: "MONTHLY_CREDIT",
      due_days: 30,
      deposit_mode: "MANUAL",
      version: 0,
      reason: "Manual deposit agreement",
    }),
    randomUUID(),
  ]);
  await cycle({
    selection: "PARTIAL",
    payments: [
      {
        method: "CASH",
        amount: "600",
        current_amount: "100",
        deposit_amount: "500",
        allocations: [],
        reference: "",
      },
    ],
  });
  await close("600");
  const old = (await detail()).report;
  day = await rpc("open_inventory_business_day", [randomUUID()]);
  const next = (await detail()).report;
  expect(next.totals).toMatchObject({
    trips: 0,
    sales: "0",
    collections: "0",
    new_credit: "0",
    old_credit_recovered: "0",
    outstanding: "11920.00",
    deposit_liability: "500.00",
  });
  expect(next.custody).toEqual(old.custody);
  expect(next.credit).toEqual(old.credit);
  expect(next.deposit_balances).toEqual(old.deposit_balances);
  for (const s of old.stock) {
    const n = next.stock.find(
      (n) =>
        n.location_id === s.location_id &&
        n.product_id === s.product_id &&
        n.stock_kind === s.stock_kind,
    )!;
    expect(n.opening).toBe(s.closing);
    expect(n.closing).toBe(s.closing);
  }
  expect((await detail(old.day.id)).report).toEqual(old);
});
it("old-credit repayment is a current collection and never another sale", async () => {
  const t = await newTrip();
  await visit(t, 10, 0);
  await reconcile(t, 90, 0);
  const invoice = (await detail()).report.customers[0]!.invoice_id!;
  await close();
  const old = (await detail()).report;
  day = await rpc("open_inventory_business_day", [randomUUID()]);
  const nextTrip = await newTrip(10);
  await rpc("finance_command", [
    "PAYMENT",
    JSON.stringify({
      trip: nextTrip,
      customer,
      method: "CASH",
      amount: "100",
      deposit_amount: "0",
      allocations: [{ invoice_id: invoice, amount: "100" }],
      reference: "",
    }),
    randomUUID(),
  ]);
  await reconcile(nextTrip, 10, 0);
  const current = (await detail()).report;
  expect(current.totals).toMatchObject({
    sales: "0",
    collections: "100.00",
    old_credit_recovered: "100.00",
    outstanding: "1402.50",
  });
  expect(groupedTrips(current, "driver")[0]!.collections).toBe("100.00");
  await close("100");
  expect((await detail(old.day.id)).report).toEqual(old);
});
it("same-day invoice repayment counts in collections without pretending it is previous-day recovery", async () => {
  const t = await newTrip();
  await visit(t, 10, 0);
  await who();
  const invoice = (await detail()).report.customers[0]!.invoice_id!;
  await who(driver);
  await rpc("finance_command", [
    "PAYMENT",
    JSON.stringify({
      trip: t,
      customer,
      method: "CASH",
      amount: "50",
      deposit_amount: "0",
      allocations: [{ invoice_id: invoice, amount: "50" }],
      reference: "",
    }),
    randomUUID(),
  ]);
  await who();
  expect((await detail()).report.totals).toMatchObject({
    collections: "50.00",
    old_credit_recovered: "0",
  });
});
it("a day crossing Nepal midnight keeps its date and all transactions; no time cutoff closes it", async () => {
  await db.exec("reset role");
  await db.query(
    "update public.business_days set date_label='2026-10-10',opened_at='2026-10-10T01:15:00Z' where id=$1",
    [day],
  );
  await who();
  await cycle();
  await close();
  const r = (await detail()).report;
  expect(r.day.date_label).toBe("2026-10-10");
  expect(r.totals.full_jars).toBe(80);
  expect(r.movements.every((m) => m.business_day_id === day)).toBe(true);
});
it("failed close audit rolls back status, snapshot and idempotency record atomically", async () => {
  await command("REVIEW", { version: 1 });
  await db.exec(`reset role;create function public.fail_close_test() returns trigger language plpgsql as $$begin if new.action='DAY_CLOSED' then raise exception 'Injected closing failure';end if;return new;end$$;
 create trigger test_close_failure before insert on public.audit_events for each row execute function public.fail_close_test();`);
  await who();
  const key = randomUUID();
  await rejects(
    "business_day_command",
    ["CLOSE", day, JSON.stringify(closeData(2)), key],
    /Injected/,
  );
  expect((await detail()).report.day).toMatchObject({
    status: "CLOSING_REVIEW",
    closed_at: null,
  });
  expect(await value("select count(*) from public.business_day_closings")).toBe(
    0,
  );
  await db.exec("reset role");
  expect(
    await value(
      "select count(*) from public.operation_requests where idempotency_key=$1",
      [key],
    ),
  ).toBe(0);
});
it("closed archives reject owner edits and ordinary stock/finance mutations", async () => {
  await cycle();
  const invoice = (await detail()).report.customers[0]!.invoice_id!;
  await close();
  await rejects(
    "adjust_warehouse_stock",
    [jar, "FULL_JAR", 1, "Closed blocked", "", day, randomUUID()],
    /OPEN/,
  );
  await rejects(
    "finance_command",
    [
      "ADJUST",
      JSON.stringify({
        invoice,
        day,
        subtotal_delta: "1",
        tax_delta: "0",
        reason: "Closed blocked",
      }),
      randomUUID(),
    ],
    /OPEN/,
  );
  await db.exec("savepoint rejected;reset role");
  await expect(
    db.exec("update public.business_day_closings set report='{}'::jsonb"),
  ).rejects.toThrow(/immutable/);
  await db.exec("rollback to savepoint rejected");
  await db.exec("savepoint rejected;reset role");
  await expect(
    db.query(
      "update public.business_days set status='OPEN',closed_at=null,closed_by=null where id=$1",
      [day],
    ),
  ).rejects.toThrow(/immutable/);
  await db.exec("rollback to savepoint rejected");
});
it("post-close stock and invoice corrections append visible amendments while original reports stay unchanged", async () => {
  await cycle();
  const oldDay = day,
    original = (await detail()).report.customers[0]!.invoice_id!;
  await close();
  const old = (await detail()).report;
  day = await rpc("open_inventory_business_day", [randomUUID()]);
  const data = {
      posting_day: day,
      product: jar,
      stock_kind: "FULL_JAR",
      delta: 1,
      reason: "Documented prior count correction",
    },
    key = randomUUID();
  const id = await command("STOCK_CORRECTION", data, key, oldDay);
  expect(await command("STOCK_CORRECTION", data, key, oldDay)).toBe(id);
  await rpc("finance_command", [
    "ADJUST",
    JSON.stringify({
      invoice: original,
      day,
      direction: "DEBIT",
      subtotal_amount: "10",
      tax_amount: "0",
      reason: "Documented prior invoice correction",
    }),
    randomUUID(),
  ]);
  const history = await detail(oldDay);
  expect(history.report).toEqual(old);
  expect(history.amendments).toHaveLength(2);
  expect(history.amendments.every((a) => a.posting_day_id === day)).toBe(true);
  expect((await detail()).report.totals.sales).toBe("10.00");
  expect(
    (await detail()).report.stock.find((s) => s.stock_kind === "FULL_JAR")!
      .closing,
  ).toBe(21);
});
it("date filters use business labels and history snapshots remain stable after customer renames", async () => {
  await cycle();
  await close();
  const before = JSON.stringify((await detail()).report);
  const label = (await detail()).report.day.date_label;
  const selected = await rpc<HistoryDay[]>("business_day_history", [
    label,
    label,
  ]);
  expect(selected).toHaveLength(1);
  expect(selected[0]!.archived).toBe(true);
  expect(
    await rpc("business_day_history", ["1990-01-01", "1990-01-02"]),
  ).toEqual([]);
  await rpc("save_customer", [
    customer,
    "Renamed customer",
    "Shop",
    "",
    "",
    "",
    true,
    1,
    "New customer name",
    randomUUID(),
  ]);
  expect(JSON.stringify((await detail()).report)).toBe(before);
});
it("historical PDF and Excel-compatible CSV use the same stored totals, snapshots and reconciliation records", async () => {
  await cycle({ selection: "CASH" });
  await close("12020");
  const r = (await detail()).report;
  const csv = dailyCsv(r);
  expect(csv).toContain('"Sales excluding tax",,12020.00');
  expect(csv).toContain('"Previous-day credit recovered",,0');
  expect(csv).toContain("Trip reconciliation");
  expect(csv).toContain("65");
  const bytes = await receiptPdf(dailyDocument(r));
  const loading = getDocument({ data: bytes, useSystemFonts: false });
  const pdf = await loading.promise;
  let text = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    text += (await page.getTextContent()).items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ");
  }
  expect(text).toContain("Closing archive v1");
  expect(text).toContain("Sales excluding tax");
  expect(text).toContain("12,020.00");
  expect(text).toContain("Physical returns counted");
  await loading.destroy();
}, 30000);
