import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID, createHash } from "node:crypto";
import { beforeAll, afterAll, beforeEach, afterEach, expect, it } from "vitest";
import {
  instantJarStatus,
  type InstantWorkspace,
  type InstantHistory,
} from "@/domain/instant";
import type { Workspace } from "@/domain/operations/types";
import type { FinanceWorkspace } from "@/domain/finance/types";
import type { DayDetail } from "@/domain/business-days/types";
import type { Receipt } from "@/domain/offline/types";
import { canonical } from "@/domain/offline/operations";
import { roundFinance } from "@/domain/operations/driver-workspace";
import type { AdminJarWorkspace } from "@/domain/operations/admin-jars";
let db: PGlite, day: string, trip: string;
const admin = randomUUID(),
  driver = randomUUID(),
  other = randomUUID(),
  jar = randomUUID(),
  carton = randomUUID(),
  vehicle = randomUUID(),
  device = randomUUID(),
  token = "a".repeat(64);
async function who(id = admin, role = "authenticated") {
  await db.exec(`reset role;set role ${role}`);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
}
async function rpc<T = string>(name: string, args: unknown[] = []): Promise<T> {
  return (
    await db.query<{ v: T }>(
      `select public.${name}(${args.map((_, i) => `$${i + 1}`).join(",")}) v`,
      args,
    )
  ).rows[0]!.v;
}
const workspace = (id: string | null = trip) =>
  rpc<Workspace>("operations_workspace", [id]);
const finance = () => rpc<FinanceWorkspace>("finance_workspace");
const instants = () => rpc<InstantWorkspace>("instant_workspace");
const items = (full = 20, empty = 20) =>
  JSON.stringify([
    { product_id: jar, full_jars: full, empty_jars: empty, cartons: 0 },
  ]);
const counts = (full: number, empty: number) =>
  JSON.stringify([
    { product_id: jar, stock_kind: "FULL_JAR", quantity: full },
    { product_id: jar, stock_kind: "EMPTY_JAR", quantity: empty },
  ]);
async function denied(
  name: string,
  args: unknown[],
  match = /access|authorized|permission|phone|balance|exceeds|amount|stock|existing|exists|collected/i,
) {
  await db.exec("savepoint denied");
  await expect(rpc(name, args)).rejects.toThrow(match);
  await db.exec("rollback to savepoint denied");
}
async function instant(
  full = 20,
  empty = 20,
  credit = false,
  phone = "9801234567",
  id = randomUUID(),
  key = randomUUID(),
) {
  await rpc("post_instant_delivery", [
    trip,
    id,
    "Wedding event",
    phone,
    "Baneshwor",
    items(full, empty),
    credit ? "CREDIT" : "PAID",
    credit ? null : String(full * 10),
    "Event delivery",
    key,
  ]);
  return id;
}
async function start(load = 100, cartons = 0) {
  await who();
  trip = randomUUID();
  await rpc("create_trip", [
    trip,
    driver,
    vehicle,
    day,
    "[]",
    "",
    randomUUID(),
  ]);
  await rpc("load_trip", [
    trip,
    JSON.stringify([
      ...(load
        ? [{ product_id: jar, stock_kind: "FULL_JAR", quantity: load }]
        : []),
      ...(cartons
        ? [
            {
              product_id: carton,
              stock_kind: "BOTTLE_CARTON",
              quantity: cartons,
            },
          ]
        : []),
    ]),
    randomUUID(),
  ]);
  await who(driver);
  await rpc("transition_trip", [trip, "START", "", randomUUID()]);
}
async function collector() {
  await db.exec("reset role");
  await db.query("update public.profiles set name='Driver B' where id=$1", [
    other,
  ]);
  const v = randomUUID(),
    t = randomUUID();
  await who();
  await rpc("save_vehicle", [
    v,
    "COLLECTOR-B",
    "",
    true,
    0,
    "Isolated collector vehicle",
    randomUUID(),
  ]);
  await rpc("create_trip", [t, other, v, day, "[]", "", randomUUID()]);
  await rpc("load_trip", [
    t,
    JSON.stringify([{ product_id: jar, stock_kind: "FULL_JAR", quantity: 10 }]),
    randomUUID(),
  ]);
  await who(other);
  await rpc("transition_trip", [t, "START", "", randomUUID()]);
  return t;
}
async function adminJars(id: string) {
  const result = await rpc<AdminJarWorkspace>("admin_jar_workspace", [
    new Date(Date.now() - 86400000).toISOString(),
    new Date(Date.now() + 86400000).toISOString(),
  ]);
  return result.customers
    .find((c) => c.id === id)!
    .balances.reduce((n, b) => n + b.quantity, 0);
}
async function closeDay(full: number, empty: number, cash: string) {
  await rpc("submit_trip", [trip, counts(full, empty), randomUUID()]);
  await who();
  await rpc("reconcile_trip", [
    trip,
    counts(full, empty),
    "Physical warehouse count confirmed",
    false,
    randomUUID(),
  ]);
  await finishDay(cash);
}
async function finishDay(cash: string) {
  const detail = await rpc<DayDetail>("business_day_report", [day]),
    version = detail.report.day.version;
  await rpc("business_day_command", [
    "REVIEW",
    day,
    JSON.stringify({ version }),
    randomUUID(),
  ]);
  await rpc("business_day_command", [
    "CLOSE",
    day,
    JSON.stringify({
      version: version + 1,
      cash_counted: cash,
      notes: "All warehouse and finance checks completed",
      cash_checked: true,
      fonepay_checked: true,
      stock_checked: true,
      balances_checked: true,
      confirmed: true,
    }),
    randomUUID(),
  ]);
  day = await rpc("open_inventory_business_day", [randomUUID()]);
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(
    "create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;",
  );
  for (const f of readdirSync("supabase/migrations").sort())
    await db.exec(readFileSync(`supabase/migrations/${f}`, "utf8"));
  for (const [id, role] of [
    [admin, "ADMIN"],
    [driver, "DRIVER"],
    [other, "DRIVER"],
  ]) {
    await db.query("insert into auth.users values($1)", [id]);
    await db.query(
      "insert into public.profiles(id,name,role,approval_status) values($1,$2,$3,'APPROVED')",
      [id, role, role],
    );
  }
});
afterAll(async () => {
  await db?.close();
});
beforeEach(async () => {
  await db.exec("begin");
  await who();
  await rpc("save_product", [
    jar,
    "INSTANT-JAR",
    "20L event jar",
    "FULL_JAR",
    "jar",
    "10",
    true,
    0,
    "Isolated fixture",
    randomUUID(),
  ]);
  await rpc("save_product", [
    carton,
    "INSTANT-CARTON",
    "Water carton",
    "BOTTLE_CARTON",
    "carton",
    "25",
    true,
    0,
    "Isolated fixture",
    randomUUID(),
  ]);
  day = await rpc("open_inventory_business_day", [randomUUID()]);
  // Disposable posting day ends before the real Nepal date, permitting a
  // successive day without changing the production clock or date functions.
  await db.exec("reset role");
  await db.query(
    "update public.business_days set date_label=date_label-1 where id=$1",
    [day],
  );
  await who();
  await rpc("adjust_warehouse_stock", [
    jar,
    "FULL_JAR",
    200,
    "Isolated warehouse opening",
    "",
    day,
    randomUUID(),
  ]);
  await rpc("save_vehicle", [
    vehicle,
    "INSTANT-100",
    "",
    true,
    0,
    "Isolated fixture",
    randomUUID(),
  ]);
  await start();
});
afterEach(async () => {
  await db.exec("rollback");
});

it("posts 20/20 as a completed paid event with one invoice, receipt, customer reference and stock deduction", async () => {
  const id = await instant(20, 20, false, "");
  const record = (await instants()).records[0]!;
  expect(record).toMatchObject({
    id,
    pending: 0,
    returned: 20,
    total: "200.00",
    outstanding: "0.00",
    collected: "200.00",
    is_one_time: true,
  });
  expect(typeof record.items[0]!.unit_price_snapshot).toBe("string");
  const history = await rpc<InstantHistory>("instant_history", [id]);
  expect(typeof history.payments[0]!.amount).toBe("string");
  const w = await workspace(),
    f = await finance();
  expect(w.customers.find((c) => c.id === id)?.is_one_time).toBe(true);
  expect(w.balances.find((b) => b.stock_kind === "FULL_JAR")!.quantity).toBe(
    80,
  );
  expect(w.balances.find((b) => b.stock_kind === "EMPTY_JAR")!.quantity).toBe(
    20,
  );
  expect(f.sales).toHaveLength(1);
  expect(f.invoices).toHaveLength(1);
  expect(f.payments).toHaveLength(1);
  expect(f.journal).toHaveLength(0);
  expect(roundFinance(f, trip)).toMatchObject({
    sales: "200.00",
    cash: "200.00",
  });
  await who();
  expect((await instants()).records).toHaveLength(1);
});
it("requires contact identification only when credit or reusable jars remain outstanding", async () => {
  await denied(
    "post_instant_delivery",
    [
      trip,
      randomUUID(),
      "Party",
      "",
      "Kathmandu",
      items(20, 15),
      "PAID",
      "200",
      "",
      randomUUID(),
    ],
    /phone/,
  );
  await denied(
    "post_instant_delivery",
    [
      trip,
      randomUUID(),
      "Party",
      "phone9801234567",
      "Kathmandu",
      items(),
      "CREDIT",
      null,
      "",
      randomUUID(),
    ],
    /phone/,
  );
  expect((await instants()).records).toHaveLength(0);
  expect((await workspace()).visits).toHaveLength(0);
});
it("keeps the original event business date after the same trip resumes from overnight carryover", async () => {
  const id = await instant(20, 15, true);
  const original = (await instants()).records[0]!;
  await who();
  await rpc("trip_preparation_command", [
    trip,
    "CARRYOVER",
    null,
    "Inspected overnight vehicle load",
    null,
    randomUUID(),
  ]);
  await finishDay("0");
  await who(driver);
  await rpc("transition_trip", [trip, "CONTINUE", "", randomUUID()]);
  const resumed = (await instants()).records[0]!;
  expect(resumed).toMatchObject({
    id,
    business_date: original.business_date,
    pending: 5,
    outstanding: "200.00",
  });
  expect((await workspace()).trips[0]!.business_day_id).toBe(day);
  expect(
    (await workspace()).days.find((d) => d.id === day)!.date_label,
  ).not.toBe(original.business_date);
});
it("preserves five outstanding jars across daily close and collects them on a later trip without a new sale", async () => {
  await instant();
  const id = await instant(20, 15);
  const oldDay = day;
  expect((await instants()).records.find((r) => r.id === id)!.pending).toBe(5);
  await closeDay(60, 35, "400");
  expect(day).not.toBe(oldDay);
  expect((await instants()).records.find((r) => r.id === id)!.pending).toBe(5);
  await start(10);
  const key = randomUUID();
  const args = [
    trip,
    id,
    "",
    "",
    items(0, 5),
    "RETURN_ONLY",
    null,
    "Later event collection",
    key,
  ];
  await rpc("post_driver_delivery", args);
  await rpc("post_driver_delivery", args);
  const r = (await instants()).records.find((r) => r.id === id)!;
  expect(r.pending).toBe(0);
  expect(r.returned).toBe(20);
  await who();
  const f = await finance();
  expect(f.sales).toHaveLength(2);
  expect(f.invoices).toHaveLength(2);
  expect(f.payments).toHaveLength(2);
  const history = await rpc<InstantHistory>("instant_history", [id]);
  expect(history.jars.at(-1)!.delta).toBe(-5);
  const w = await workspace(),
    location = w.vehicles.find((v) => v.id === vehicle)!.location_id;
  expect(
    w.balances.find(
      (b) => b.location_id === location && b.stock_kind === "EMPTY_JAR",
    )!.quantity,
  ).toBe(5);
});
it("collects old event credit on a later business day without counting a new sale", async () => {
  const id = await instant(20, 20, true);
  expect((await instants()).records[0]!.outstanding).toBe("200.00");
  await closeDay(80, 20, "0");
  await start(10);
  const invoice = (await instants()).records[0]!.invoice_id!,
    key = randomUUID();
  const data = JSON.stringify({
    trip,
    customer: id,
    method: "CASH",
    amount: "200",
    current_amount: "0",
    deposit_amount: "0",
    reference: "",
    allocations: [{ invoice_id: invoice, amount: "200" }],
  });
  await rpc("finance_command", ["PAYMENT", data, key]);
  await rpc("finance_command", ["PAYMENT", data, key]);
  const r = (await instants()).records[0]!;
  expect(r.outstanding).toBe("0.00");
  expect(r.collected).toBe("200.00");
  expect(roundFinance(await finance(), trip, day)).toMatchObject({
    sales: "0.00",
    cash: "200.00",
  });
  await who();
  const f = await finance();
  expect(f.sales).toHaveLength(1);
  expect(f.payments).toHaveLength(1);
  expect(f.payments[0]!.business_day_id).toBe(day);
  expect(f.sales[0]!.business_day_id).not.toBe(day);
});
it("converts the existing reference without duplicating history or resolving unpaid balances", async () => {
  const id = await instant(20, 15, true);
  const before = (await instants()).records[0]!;
  await who();
  await rpc("convert_instant_customer", [
    id,
    "Now a regular delivery customer",
    randomUUID(),
  ]);
  const after = (await instants()).records[0]!;
  expect(after).toMatchObject({
    customer_id: id,
    visit_id: before.visit_id,
    pending: 5,
    outstanding: "200.00",
    is_one_time: false,
  });
  expect((await workspace()).customers).toHaveLength(1);
});
it("keeps the original event's FIFO liability separate from future regular deliveries after conversion", async () => {
  const id = await instant(20, 15);
  await who();
  await rpc("convert_instant_customer", [
    id,
    "Continuing regular customer",
    randomUUID(),
  ]);
  await who(driver);
  await rpc("post_driver_delivery", [
    trip,
    id,
    "",
    "",
    items(20, 0),
    "CREDIT",
    null,
    "Later regular delivery",
    randomUUID(),
  ]);
  expect((await instants()).records[0]!.pending).toBe(5);
  await rpc("post_driver_delivery", [
    trip,
    id,
    "",
    "",
    items(0, 5),
    "RETURN_ONLY",
    null,
    "First event FIFO collection",
    randomUUID(),
  ]);
  expect((await instants()).records[0]!.pending).toBe(0);
  expect(
    (await workspace()).custody.find((c) => c.customer_id === id)!.quantity,
  ).toBe(20);
});
it("uses the audited custody exception for permanent purchase/resolution rather than inventing a jar-sale price", async () => {
  const id = await instant(20, 15);
  await who();
  await rpc("adjust_customer_custody", [
    id,
    jar,
    -5,
    day,
    "Physical jars permanently purchased; authorized exception",
    randomUUID(),
  ]);
  const r = (await instants()).records[0]!;
  expect(r.pending).toBe(0);
  expect(r.returned).toBe(15);
  expect(instantJarStatus(r)).toBe("Resolved by Adjustment");
  expect((await finance()).sales).toHaveLength(1);
});
it("deduplicates retried requests but keeps genuinely separate events sharing one phone distinct", async () => {
  const id = randomUUID(),
    key = randomUUID();
  await instant(20, 15, false, "9801234567", id, key);
  await instant(20, 15, false, "9801234567", id, key);
  expect((await instants()).records).toHaveLength(1);
  await instant(20, 15);
  expect((await instants()).records).toHaveLength(2);
  expect((await finance()).payments).toHaveLength(2);
});
it("rolls back the lightweight reference with failed prices, payments or stock checks", async () => {
  await denied(
    "post_instant_delivery",
    [
      trip,
      randomUUID(),
      "Party",
      "9801234567",
      "Kathmandu",
      items(),
      "PAID",
      "199",
      "",
      randomUUID(),
    ],
    /amount/,
  );
  await denied(
    "post_instant_delivery",
    [
      trip,
      randomUUID(),
      "Party",
      "9801234567",
      "Kathmandu",
      items(101, 0),
      "CREDIT",
      null,
      "",
      randomUUID(),
    ],
    /stock|negative|sufficient/i,
  );
  expect((await instants()).records).toHaveLength(0);
  expect((await workspace()).customers).toHaveLength(0);
});
it("rejects unmatched extra empties instead of silently creating negative customer balances", async () => {
  await denied(
    "post_instant_delivery",
    [
      trip,
      randomUUID(),
      "Party",
      "9801234567",
      "Kathmandu",
      items(20, 21),
      "PAID",
      "200",
      "",
      randomUUID(),
    ],
    /balance/,
  );
  expect((await workspace()).visits).toHaveLength(0);
});
it("keeps warehouse quantities unchanged until the established physical reconciliation", async () => {
  await instant(20, 15);
  await who();
  const w = await workspace(null),
    main = w.locations.find((l) => l.code === "MAIN")!.id;
  expect(
    w.balances.find(
      (b) => b.location_id === main && b.stock_kind === "FULL_JAR",
    )!.quantity,
  ).toBe(100);
  expect(
    w.balances
      .filter((b) => b.location_id === main && b.stock_kind === "EMPTY_JAR")
      .reduce((n, b) => n + b.quantity, 0),
  ).toBe(0);
});
it("protects other drivers' references, private helpers and admin-only conversion", async () => {
  const id = await instant();
  await denied("convert_instant_customer", [
    id,
    "Unauthorized conversion",
    randomUUID(),
  ]);
  await who(other);
  expect((await instants()).records).toHaveLength(0);
  await denied("instant_history", [id]);
  await denied("instant_row", [id]);
  await who(driver, "anon");
  await denied("instant_workspace", []);
});
it.each([false, true])(
  "collects five jars next day on Driver B's vehicle, keeps both dashboards consistent and creates no second sale/payment (offline=%s)",
  async (offline) => {
    const id = await instant(20, 15);
    await who();
    expect(await adminJars(id)).toBe(5);
    await who(driver);
    await closeDay(80, 15, "200");
    expect((await instants()).records[0]!.pending).toBe(5);
    const second = await collector();
    expect((await instants()).records[0]).toMatchObject({
      id,
      pending: 5,
      documents_allowed: false,
    });
    const pending = await rpc<{
      rows: { customer_id: string; pending: number }[];
    }>("pending_jar_workspace", [second, id]);
    expect(pending.rows.reduce((n, r) => n + r.pending, 0)).toBe(5);
    const key = randomUUID();
    if (offline) {
      const dev = randomUUID(),
        secret = "b".repeat(64);
      await rpc("offline_register", [second, dev, secret]);
      const payload = canonical({
        customer: id,
        items: JSON.parse(items(0, 5)),
        status: "RETURN_ONLY",
        received: null,
        total: "0.00",
        notes: "Next-day collection by Driver B",
        walk_name: "",
        walk_phone: "",
        prices: [{ product_id: jar, price: "10.00" }],
        custody: [{ product_id: jar, quantity: 5 }],
      });
      const args = [
        second,
        dev,
        secret,
        key,
        1,
        "DELIVERY",
        new Date().toISOString(),
        payload,
        createHash("sha256").update(payload).digest("hex"),
      ];
      expect(await rpc<Receipt>("offline_post", args)).toMatchObject({
        status: "CONFIRMED",
      });
      expect(await rpc<Receipt>("offline_post", args)).toMatchObject({
        status: "CONFIRMED",
      });
    } else {
      const args = [
        second,
        id,
        "",
        "",
        items(0, 5),
        "RETURN_ONLY",
        null,
        "Next-day collection by Driver B",
        key,
      ];
      await rpc("post_driver_delivery", args);
      await rpc("post_driver_delivery", args);
    }
    expect((await instants()).records[0]).toMatchObject({
      id,
      pending: 0,
      returned: 20,
      documents_allowed: true,
    });
    const history = await rpc<InstantHistory>("instant_history", [id]);
    expect(history.jars.at(-1)).toMatchObject({
      delta: -5,
      balance: 0,
      driver: "Driver B",
    });
    const collecting = await workspace(second);
    expect(
      collecting.balances.find((b) => b.stock_kind === "EMPTY_JAR")!.quantity,
    ).toBe(5);
    expect(
      collecting.balances.find((b) => b.stock_kind === "FULL_JAR")!.quantity,
    ).toBe(10);
    await who();
    expect(await adminJars(id)).toBe(0);
    const f = await finance();
    expect(f.sales).toHaveLength(1);
    expect(f.invoices).toHaveLength(1);
    expect(f.payments).toHaveLength(1);
    const all = await workspace(null),
      main = all.locations.find((l) => l.code === "MAIN")!.id;
    expect(
      all.balances.find(
        (b) => b.location_id === main && b.stock_kind === "EMPTY_JAR",
      )!.quantity,
    ).toBe(15);
    await who(other);
    if (offline) {
      // The registered round requires its existing queue checkpoint/submit path;
      // warehouse timing is independently exercised below with an online round.
      return;
    }
    await rpc("submit_trip", [second, counts(10, 5), randomUUID()]);
    await who();
    await rpc("reconcile_trip", [
      second,
      counts(10, 5),
      "Physical collector warehouse receipt",
      false,
      randomUUID(),
    ]);
    expect(
      (await workspace(null)).balances.find(
        (b) => b.location_id === main && b.stock_kind === "EMPTY_JAR",
      )!.quantity,
    ).toBe(20);
  },
);
it("allows Driver B to collect original event credit on a later trip without a new sale", async () => {
  const id = await instant(20, 15, true);
  await closeDay(80, 15, "0");
  const second = await collector();
  const record = (await instants()).records[0]!;
  expect(record.outstanding).toBe("200.00");
  const args = [
    "PAYMENT",
    JSON.stringify({
      trip: second,
      customer: id,
      method: "CASH",
      amount: "200.00",
      reference: "",
      deposit_amount: "0",
      allocations: [{ invoice_id: record.invoice_id, amount: "200.00" }],
    }),
    randomUUID(),
  ];
  await rpc("finance_command", args);
  await rpc("finance_command", args);
  expect((await instants()).records[0]).toMatchObject({
    pending: 5,
    outstanding: "0.00",
    collected: "200.00",
  });
  expect(roundFinance(await finance(), second)).toMatchObject({
    sales: "0.00",
    cash: "200.00",
  });
  await who();
  expect((await finance()).sales).toHaveLength(1);
  expect((await finance()).payments).toHaveLength(1);
});
it("supports carton-only one-time orders without jar obligations or permanent registration", async () => {
  await closeDay(100, 0, "0");
  await who();
  await rpc("adjust_warehouse_stock", [
    carton,
    "BOTTLE_CARTON",
    10,
    "Isolated carton opening",
    "",
    day,
    randomUUID(),
  ]);
  await start(0, 10);
  const id = randomUUID();
  await rpc("post_instant_delivery", [
    trip,
    id,
    "Carton party",
    "",
    "Lakeside",
    JSON.stringify([
      { product_id: carton, full_jars: 0, empty_jars: 0, cartons: 3 },
    ]),
    "PAID",
    "75.00",
    "",
    randomUUID(),
  ]);
  expect((await instants()).records[0]).toMatchObject({
    pending: 0,
    returned: 0,
    total: "75.00",
    outstanding: "0.00",
  });
  expect(
    (await workspace()).balances.find((b) => b.stock_kind === "BOTTLE_CARTON")!
      .quantity,
  ).toBe(7);
  expect((await workspace()).customers[0]).toMatchObject({
    is_one_time: true,
    supply_type: "REGULAR",
    house_status: "NONE",
  });
});
it("refuses a new Instant Delivery without an active authorized trip", async () => {
  await closeDay(100, 0, "0");
  await who(driver);
  await denied(
    "post_instant_delivery",
    [
      trip,
      randomUUID(),
      "No trip party",
      "9801234567",
      "Lakeside",
      items(1, 0),
      "PAID",
      "10",
      "",
      randomUUID(),
    ],
    /ACTIVE|trip|open/i,
  );
  expect((await instants()).records).toHaveLength(0);
});
it("never grants ordinary events HOUSE free-supply privileges", async () => {
  await denied(
    "post_instant_delivery",
    [
      trip,
      randomUUID(),
      "Temporary HOUSE",
      "9801234567",
      "Lakeside",
      items(20, 0),
      "FREE_SUPPLY",
      "0",
      "",
      randomUUID(),
    ],
    /valid event/,
  );
  expect((await instants()).records).toHaveLength(0);
  expect((await finance()).invoices).toHaveLength(0);
});
it("keeps other-driver stock protected even when event lookup is authorized", async () => {
  await instant(20, 15);
  await collector();
  await denied("post_instant_delivery", [
    trip,
    randomUUID(),
    "Wrong vehicle",
    "9801234567",
    "Lakeside",
    items(1, 0),
    "PAID",
    "10",
    "",
    randomUUID(),
  ]);
  await denied("convert_instant_customer", [
    (await instants()).records[0]!.id,
    "Driver cannot convert",
    randomUUID(),
  ]);
});
it("accepts a durable offline Instant envelope once and preserves the original occurrence time", async () => {
  await rpc("offline_register", [trip, device, token]);
  const id = randomUUID(),
    key = randomUUID(),
    occurred = new Date().toISOString();
  const draft = {
    customer: id,
    instant: {
      id,
      name: "Offline wedding",
      phone: "9801234567",
      location: "Patan",
    },
    items: JSON.parse(items(20, 15)),
    status: "PAID",
    received: "200.00",
    total: "200.00",
    notes: "",
    walk_name: "",
    walk_phone: "",
    prices: [{ product_id: jar, price: "10.00" }],
    custody: [{ product_id: jar, quantity: 0 }],
  };
  const payload = canonical(draft),
    args = [
      trip,
      device,
      token,
      key,
      1,
      "INSTANT",
      occurred,
      payload,
      createHash("sha256").update(payload).digest("hex"),
    ];
  const receipt = await rpc<Receipt>("offline_post", args);
  expect(receipt.status).toBe("CONFIRMED");
  expect(receipt.customer).toBe(id);
  await rpc("offline_post", args);
  expect((await instants()).records).toHaveLength(1);
  expect((await finance()).payments).toHaveLength(1);
  expect(Date.parse((await instants()).records[0]!.created_at)).toBe(
    Date.parse(occurred),
  );
  expect(
    (await workspace()).balances.find((b) => b.stock_kind === "FULL_JAR")!
      .quantity,
  ).toBe(80);
});
it("holds an offline price conflict for review with no partial customer, sale or stock posting", async () => {
  await rpc("offline_register", [trip, device, token]);
  const id = randomUUID(),
    key = randomUUID();
  const payload = canonical({
    customer: id,
    instant: {
      id,
      name: "Price conflict",
      phone: "9801234567",
      location: "Patan",
    },
    items: JSON.parse(items()),
    status: "PAID",
    received: "200.00",
    total: "200.00",
    notes: "",
    prices: [{ product_id: jar, price: "11.00" }],
  });
  const r = await rpc<Receipt>("offline_post", [
    trip,
    device,
    token,
    key,
    1,
    "INSTANT",
    new Date().toISOString(),
    payload,
    createHash("sha256").update(payload).digest("hex"),
  ]);
  expect(r.status).toBe("NEEDS_REVIEW");
  expect((await instants()).records).toHaveLength(0);
  expect((await workspace()).customers).toHaveLength(0);
});
