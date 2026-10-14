import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID, createHash } from "node:crypto";
import { beforeAll, afterAll, beforeEach, afterEach, it, expect } from "vitest";
import type {
  AdminJarWorkspace,
  JarHistory,
} from "@/domain/operations/admin-jars";
import { jarQuantity, jarSummary } from "@/domain/operations/admin-jars";
import { presetRange } from "@/domain/localization/calendar";
import type { Workspace } from "@/domain/operations/types";
import type { DeliveryCustomerContext } from "@/domain/operations/customer-context";
import type { FinanceWorkspace } from "@/domain/finance/types";
import { canonical } from "@/domain/offline/operations";
import type { Receipt } from "@/domain/offline/types";

const admin = randomUUID(),
  driver = randomUUID(),
  other = randomUUID(),
  jar = randomUUID(),
  customer = randomUUID(),
  house = randomUUID(),
  zero = randomUUID(),
  vehicle = randomUUID(),
  device = randomUUID(),
  token = "d".repeat(64);
let db: PGlite, day: string, trip: string;
async function who(id = admin, role = "authenticated") {
  await db.exec(`reset role;set role ${role}`);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
}
async function rpc<T = string>(name: string, args: unknown[] = []) {
  return (
    await db.query<{ value: T }>(
      `select public.${name}(${args.map((_, i) => `$${i + 1}`).join(",")}) value`,
      args,
    )
  ).rows[0]!.value;
}
async function denied(name: string, args: unknown[], match: RegExp) {
  await db.exec("savepoint denied");
  await expect(rpc(name, args)).rejects.toThrow(match);
  await db.exec("rollback to savepoint denied");
}
async function overview() {
  await who();
  const month = presetRange("month");
  return rpc<AdminJarWorkspace>("admin_jar_workspace", [
    month.start,
    month.end,
  ]);
}
const history = () => rpc<JarHistory>("admin_jar_history", [customer]);
const lines = (full: number, empty: number) => [
  { product_id: jar, full_jars: full, empty_jars: empty, cartons: 0 },
];
async function delivery(
  full: number,
  empty: number,
  id = customer,
  status = "CREDIT",
  key = randomUUID(),
) {
  await who(driver);
  return rpc("post_driver_delivery", [
    trip,
    id,
    "",
    "",
    lines(full, empty),
    full === 0 ? "RETURN_ONLY" : status,
    null,
    "Isolated jar test",
    key,
  ]);
}
async function start() {
  await who();
  const w = await rpc<Workspace>("operations_workspace", [null]);
  const location = w.vehicles.find((v) => v.id === vehicle)!.location_id;
  const warehouse = w.locations.find((l) => l.kind === "WAREHOUSE")!.id;
  const full = w.balances.find(
    (b) =>
      b.location_id === warehouse &&
      b.product_id === jar &&
      b.stock_kind === "FULL_JAR",
  )!.quantity;
  trip = randomUUID();
  await rpc("create_trip", [
    trip,
    driver,
    vehicle,
    day,
    [],
    "Isolated test",
    randomUUID(),
  ]);
  await rpc("load_trip", [
    trip,
    [{ product_id: jar, stock_kind: "FULL_JAR", quantity: full }],
    randomUUID(),
  ]);
  await who(driver);
  await rpc("transition_trip", [trip, "START", "", randomUUID()]);
  return location;
}
async function returnToWarehouse() {
  await who(driver);
  const w = await rpc<Workspace>("operations_workspace", [trip]);
  const location = w.vehicles.find((v) => v.id === vehicle)!.location_id;
  const counts = w.balances
    .filter((b) => b.location_id === location)
    .map((b) => ({
      product_id: b.product_id,
      stock_kind: b.stock_kind,
      quantity: b.quantity,
    }));
  await rpc("submit_trip", [trip, counts, randomUUID()]);
  await who();
  await rpc("reconcile_trip", [
    trip,
    counts,
    "Physically verified jar receipt",
    false,
    randomUUID(),
  ]);
}
async function closeDay() {
  await rpc("business_day_command", [
    "REVIEW",
    day,
    { version: 1 },
    randomUUID(),
  ]);
  await rpc("business_day_command", [
    "CLOSE",
    day,
    {
      version: 2,
      cash_counted: "0",
      notes: "Verified isolated close",
      cash_checked: true,
      fonepay_checked: true,
      stock_checked: true,
      balances_checked: true,
      confirmed: true,
    },
    randomUUID(),
  ]);
}
async function nextDay() {
  const date = (
    await db.query<{ date_label: string }>(
      "select date_label::text from public.business_days where id=$1",
      [day],
    )
  ).rows[0]!.date_label;
  const tomorrow = new Date(`${date}T00:00:00Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const label = tomorrow.toISOString().slice(0, 10);
  day = await rpc("open_inventory_business_day", [randomUUID()]);
  await db.exec("reset role");
  await db.query("update public.business_days set date_label=$1 where id=$2", [
    label,
    day,
  ]);
  // Advance only this disposable database's scheduling clock.
  await db.exec(
    `create or replace function public.trip_nepal_date() returns date language sql volatile set search_path='' as $$select '${label}'::date$$`,
  );
  await start();
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(
    "create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,email text);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;",
  );
  for (const f of readdirSync("supabase/migrations").sort())
    await db.exec(readFileSync(`supabase/migrations/${f}`, "utf8"));
  for (const id of [admin, driver, other])
    await db.query("insert into auth.users(id) values($1)", [id]);
  await db.query(
    "insert into public.profiles(id,name,role,approval_status) values($1,'Jar admin','ADMIN','APPROVED'),($2,'Jar driver','DRIVER','APPROVED'),($3,'Other driver','DRIVER','APPROVED')",
    [admin, driver, other],
  );
}, 30000);
afterAll(async () => {
  await db?.close();
});
beforeEach(async () => {
  await db.exec("reset role;begin");
  await who();
  await rpc("save_product", [
    jar,
    "JAR",
    "20L Jar",
    "FULL_JAR",
    "jar",
    "10.00",
    true,
    0,
    "Isolated jar product",
    randomUUID(),
  ]);
  await rpc("save_house_pricing", [
    jar,
    "10.00",
    true,
    "10.00",
    1,
    "Approved HOUSE supply",
    randomUUID(),
  ]);
  day = await rpc("open_inventory_business_day", [randomUUID()]);
  await rpc("adjust_warehouse_stock", [
    jar,
    "FULL_JAR",
    100,
    "Isolated opening stock",
    "",
    day,
    randomUUID(),
  ]);
  await rpc("save_vehicle", [
    vehicle,
    "JAR-TEST",
    "",
    true,
    0,
    "Isolated test vehicle",
    randomUUID(),
  ]);
  for (const [id, name] of [
    [customer, "ABC Hotel"],
    [house, "Owner's House"],
    [zero, "Zero customer"],
  ])
    await rpc("save_customer", [
      id,
      name,
      "",
      "9800000000",
      "Kathmandu",
      "",
      true,
      0,
      "Verified test customer",
      randomUUID(),
    ]);
  await rpc("save_house_customer", [
    house,
    "Owner's House",
    "",
    "9800000000",
    "Kathmandu",
    "",
    true,
    1,
    "Verified HOUSE approval",
    randomUUID(),
    "Owner",
    "HOUSE",
    "APPROVED",
  ]);
  await start();
});
afterEach(async () => {
  await db.exec("rollback;reset role");
});

it("A–D: 10 + 8 - 5 = 13, then 13 + 5 - 10 = 8, then 8 - 3 = 5 across trips, dates and daily close", async () => {
  await who();
  await rpc("adjust_customer_custody", [
    customer,
    jar,
    10,
    day,
    "Verified opening holdings",
    randomUUID(),
  ]);
  await delivery(8, 5);
  expect(
    jarQuantity((await overview()).customers.find((c) => c.id === customer)!),
  ).toBe(13);
  await returnToWarehouse();
  await closeDay();
  await nextDay();
  await delivery(5, 10);
  expect(
    jarQuantity((await overview()).customers.find((c) => c.id === customer)!),
  ).toBe(8);
  await returnToWarehouse();
  await closeDay();
  await nextDay();
  await delivery(0, 3);
  const w = await overview();
  expect(jarQuantity(w.customers.find((c) => c.id === customer)!)).toBe(5);
  expect(jarSummary(w.customers)).toMatchObject({
    outstanding: 5,
    customers: 1,
    returned: 18,
  });
  const h = await history();
  expect(h.events.map((e) => e.outstanding_after)).toEqual([5, 8, 13, 10]);
  expect(h.events[0]!.items[0]).toMatchObject({
    delivered: 0,
    returned: 3,
    net_change: -3,
  });
  expect(h.pending.reduce((n, p) => n + p.pending, 0)).toBe(5);
  expect(
    h.allocations
      .filter((a) => a.source === "Empty collection")
      .reduce((n, a) => n + a.quantity, 0),
  ).toBe(18);
  await who(driver);
  const context = await rpc<DeliveryCustomerContext>(
    "delivery_customer_context",
    [trip, customer],
  );
  expect(context.custody[0]!.quantity).toBe(5);
  await returnToWarehouse();
  await closeDay();
  expect(
    jarQuantity((await overview()).customers.find((c) => c.id === customer)!),
  ).toBe(5);
});
it("E: offline ACK replay updates the admin balance, FIFO and vehicle stock exactly once", async () => {
  await rpc("offline_register", [trip, device, token]);
  const id = randomUUID(),
    at = new Date().toISOString();
  const payload = canonical({
    customer,
    walk_name: "",
    walk_phone: "",
    items: lines(8, 5),
    status: "CREDIT",
    received: null,
    total: "80.00",
    prices: [{ product_id: jar, price: "10.00" }],
    custody: [{ product_id: jar, quantity: 0 }],
    notes: "Offline jar test",
  });
  const args = [
    trip,
    device,
    token,
    id,
    1,
    "DELIVERY",
    at,
    payload,
    createHash("sha256").update(payload).digest("hex"),
  ];
  const first = await rpc<Receipt>("offline_post", args);
  expect(first.status).toBe("CONFIRMED");
  expect(await rpc("offline_post", args)).toEqual(first);
  expect(jarSummary((await overview()).customers).outstanding).toBe(3);
  const h = await history();
  expect(h.events).toHaveLength(1);
  expect(h.events[0]).toMatchObject({ offline: true, outstanding_after: 3 });
  const w = await rpc<Workspace>("operations_workspace", [trip]);
  expect(w.visits).toHaveLength(1);
  expect(w.items).toHaveLength(1);
  const loc = w.vehicles.find((v) => v.id === vehicle)!.location_id;
  expect(
    w.balances.find(
      (b) => b.location_id === loc && b.stock_kind === "FULL_JAR",
    )!.quantity,
  ).toBe(92);
  expect(
    w.balances.find(
      (b) => b.location_id === loc && b.stock_kind === "EMPTY_JAR",
    )!.quantity,
  ).toBe(5);
});
it("E: a disputed offline operation stays out of confirmed admin cards until reviewed", async () => {
  await rpc("offline_register", [trip, device, token]);
  await who();
  await rpc("adjust_customer_custody", [
    customer,
    jar,
    5,
    day,
    "Verified opening balance on another device",
    randomUUID(),
  ]);
  await who(driver);
  const payload = canonical({
    customer,
    walk_name: "",
    walk_phone: "",
    items: lines(8, 5),
    status: "CREDIT",
    received: null,
    total: "80.00",
    prices: [{ product_id: jar, price: "10.00" }],
    custody: [{ product_id: jar, quantity: 0 }],
    notes: "Stale offline custody",
  });
  const receipt = await rpc<Receipt>("offline_post", [
    trip,
    device,
    token,
    randomUUID(),
    1,
    "DELIVERY",
    new Date().toISOString(),
    payload,
    createHash("sha256").update(payload).digest("hex"),
  ]);
  expect(receipt.status).toBe("NEEDS_REVIEW");
  expect(jarSummary((await overview()).customers)).toMatchObject({
    outstanding: 5,
    returned: 0,
  });
  expect((await history()).events).toHaveLength(1);
  const w = await rpc<Workspace>("operations_workspace", [trip]);
  expect(w.visits).toHaveLength(0);
  expect(w.items).toHaveLength(0);
});
it("complete history exceeds the old 50-entry customer context limit", async () => {
  for (let i = 0; i < 55; i++) await delivery(1, 0);
  await overview();
  const h = await history();
  expect(h.events).toHaveLength(55);
  expect(h.events[0]!.outstanding_after).toBe(55);
  expect(h.events[54]!.outstanding_after).toBe(1);
});
it("groups a multi-product visit and preserves per-product and overall historical balances", async () => {
  await returnToWarehouse();
  const second = randomUUID();
  await rpc("save_product", [
    second,
    "SECOND",
    "Second Jar",
    "FULL_JAR",
    "jar",
    "10.00",
    true,
    0,
    "Isolated product",
    randomUUID(),
  ]);
  await rpc("adjust_warehouse_stock", [
    second,
    "FULL_JAR",
    10,
    "Isolated stock",
    "",
    day,
    randomUUID(),
  ]);
  trip = randomUUID();
  await rpc("create_trip", [
    trip,
    driver,
    vehicle,
    day,
    [],
    "Multiple products",
    randomUUID(),
  ]);
  await rpc("load_trip", [
    trip,
    [
      { product_id: jar, stock_kind: "FULL_JAR", quantity: 100 },
      { product_id: second, stock_kind: "FULL_JAR", quantity: 10 },
    ],
    randomUUID(),
  ]);
  await who(driver);
  await rpc("transition_trip", [trip, "START", "", randomUUID()]);
  await rpc("post_driver_delivery", [
    trip,
    customer,
    "",
    "",
    [
      ...lines(4, 1),
      { product_id: second, full_jars: 2, empty_jars: 1, cartons: 0 },
    ],
    "CREDIT",
    null,
    "Two products",
    randomUUID(),
  ]);
  expect(jarSummary((await overview()).customers).outstanding).toBe(4);
  const h = await history();
  expect(h.events).toHaveLength(1);
  expect(h.events[0]!.outstanding_after).toBe(4);
  expect(h.events[0]!.items).toHaveLength(2);
  expect(h.events[0]!.items.find((i) => i.product_id === second)).toMatchObject(
    { product_balance: 1, delivered: 2, returned: 1 },
  );
  await who(driver);
  await rpc("post_driver_delivery", [
    trip,
    customer,
    "",
    "",
    [{ product_id: second, full_jars: 0, empty_jars: 1, cartons: 0 }],
    "RETURN_ONLY",
    null,
    "Second product return",
    randomUUID(),
  ]);
  await overview();
  expect((await history()).events.map((e) => e.outstanding_after)).toEqual([
    3, 4,
  ]);
});
it("F: approved HOUSE 10 / 7 leaves 3 jars and zero receivable for free supply", async () => {
  await delivery(10, 7, house, "FREE_SUPPLY");
  const row = (await overview()).customers.find((c) => c.id === house)!;
  expect(row.supply_type).toBe("HOUSE");
  expect(jarQuantity(row)).toBe(3);
  const f = await rpc<FinanceWorkspace>("finance_workspace");
  expect(f.invoices[0]!.subtotal).toBe("0.00");
  expect(f.credit).toHaveLength(0);
});
it("G: customer returns stay on the vehicle until physical admin receipt, without a second custody deduction", async () => {
  await delivery(8, 5);
  await who();
  const physical = async () => {
    const w = await rpc<Workspace>("operations_workspace", [trip]);
    const warehouse = w.locations.find((l) => l.kind === "WAREHOUSE")!.id;
    const loc = w.vehicles.find((v) => v.id === vehicle)!.location_id;
    return [
      w.balances.find(
        (b) => b.location_id === loc && b.stock_kind === "EMPTY_JAR",
      )?.quantity ?? 0,
      w.balances.find(
        (b) => b.location_id === warehouse && b.stock_kind === "EMPTY_JAR",
      )?.quantity ?? 0,
    ];
  };
  expect(await physical()).toEqual([5, 0]);
  const before = await history();
  await returnToWarehouse();
  expect(await physical()).toEqual([0, 5]);
  expect(await history()).toEqual(before);
});
it("H: repeated deliveries in one trip combine in one customer card, keeping all history", async () => {
  await delivery(8, 5);
  await delivery(5, 1);
  await delivery(0, 2);
  const w = await overview();
  expect(w.customers.filter((c) => c.id === customer)).toHaveLength(1);
  expect(jarQuantity(w.customers.find((c) => c.id === customer)!)).toBe(5);
  expect((await history()).events).toHaveLength(3);
});
it("I: the retained permanent-jar admin exception removes liability with an immutable audited correction", async () => {
  await delivery(8, 0);
  await who();
  const before = await history(),
    key = randomUUID();
  const args = [
    customer,
    jar,
    -8,
    day,
    "Authorized permanent purchase: all eight physical jars, no return obligation",
    key,
  ];
  const correction = await rpc("adjust_customer_custody", args);
  expect(await rpc("adjust_customer_custody", args)).toBe(correction);
  expect(
    jarQuantity((await overview()).customers.find((c) => c.id === customer)!),
  ).toBe(0);
  const after = await history();
  expect(after.events.slice(1)).toEqual(before.events);
  expect(after.events[0]).toMatchObject({
    correction: true,
    outstanding_after: 0,
    actor_name: "Jar admin",
  });
  expect(jarSummary((await overview()).customers).returned).toBe(0);
  const audit = await db.query(
    "select actor_user_id,reason from public.audit_events where entity_id=$1 and action='CUSTODY_CORRECTED'",
    [correction],
  );
  expect(audit.rows[0]).toMatchObject({
    actor_user_id: admin,
    reason: args[4],
  });
});
it("rejects excessive returns atomically and denies admin history to drivers and anonymous callers", async () => {
  await delivery(8, 5);
  await denied(
    "post_driver_delivery",
    [
      trip,
      customer,
      "",
      "",
      lines(0, 4),
      "RETURN_ONLY",
      null,
      "",
      randomUUID(),
    ],
    /jar balance/,
  );
  const month = presetRange("month");
  await denied("admin_jar_workspace", [month.start, month.end], /Admin access/);
  await denied("admin_jar_history", [customer], /Admin access/);
  await who(other);
  await denied("admin_jar_history", [customer], /Admin access/);
  await who(admin, "anon");
  await denied("admin_jar_history", [customer], /permission/);
  expect(jarSummary((await overview()).customers).outstanding).toBe(3);
});
it("ages the existing FIFO lots by Nepal local dates and counts actual monthly returns, excluding corrections", async () => {
  const month = presetRange("month");
  // Simulate synchronized historical occurrence metadata through the existing trigger.
  await db.query(
    "select set_config('mk.offline.occurred', (now()-interval '31 days')::text,true)",
  );
  await delivery(8, 0);
  await db.query(
    "select set_config('mk.offline.occurred', (now()-interval '30 days')::text,true)",
  );
  await delivery(4, 0);
  await db.query("select set_config('mk.offline.occurred','',true)");
  await delivery(0, 3);
  const w = await overview();
  expect(jarSummary(w.customers)).toMatchObject({
    outstanding: 9,
    overdue: 5,
    returned: 3,
  });
  expect(w.month_start).toBeTruthy();
  await rpc("adjust_customer_custody", [
    customer,
    jar,
    -1,
    day,
    "Verified legacy discrepancy",
    randomUUID(),
  ]);
  expect(jarSummary((await overview()).customers)).toMatchObject({
    outstanding: 8,
    overdue: 4,
    returned: 3,
  });
  // Half-open boundaries use actual return occurrence, not the correction timestamp.
  const range = await rpc<AdminJarWorkspace>("admin_jar_workspace", [
    month.start,
    new Date(Date.parse(month.start) + 1).toISOString(),
  ]);
  expect(jarSummary(range.customers).returned).toBe(0);
});
