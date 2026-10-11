import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, beforeEach, afterEach, it, expect } from "vitest";
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
    ...(cartons ? [] : []),
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
    JSON.stringify([customer]),
    "",
    randomUUID(),
  ]);
});
afterEach(async () => {
  await db.exec("rollback; reset role");
});
it("100 loaded, 80 delivered in separate visits, 65 collected, 20 full and 65 empty returned; second trip", async () => {
  await active();
  const key = randomUUID();
  const first = await visit(40, 30, key);
  expect(await visit(40, 30, key)).toBe(first);
  await visit(40, 35);
  expect(await scalar("select count(*) from public.trip_visits")).toBe(2);
  const history = (await scalar("select public.customer_delivery_history($1)", [
    customer,
  ])) as { full_jars: number; empty_jars: number }[];
  expect(history).toHaveLength(2);
  expect(history.reduce((sum, v) => sum + v.full_jars, 0)).toBe(80);
  expect(history.reduce((sum, v) => sum + v.empty_jars, 0)).toBe(65);
  expect(await scalar("select quantity from public.jar_custody_balances")).toBe(
    15,
  );
  const submitKey = randomUUID();
  await rpc("submit_trip", [trip, counts(), submitKey]);
  await rpc("submit_trip", [trip, counts(), submitKey]);
  await who(admin);
  const closeKey = randomUUID();
  await rpc("reconcile_trip", [
    trip,
    counts(),
    "Physical counts checked",
    false,
    closeKey,
  ]);
  await rpc("reconcile_trip", [
    trip,
    counts(),
    "Physical counts checked",
    false,
    closeKey,
  ]);
  expect(await scalar("select status from public.trips")).toBe("CLOSED");
  const stock = (
    await db.query<{ stock_kind: string; quantity: number }>(
      "select b.stock_kind,b.quantity from public.inventory_balances b join public.stock_locations l on l.id=b.location_id where l.code='MAIN' order by b.stock_kind",
    )
  ).rows;
  expect(stock).toEqual(
    expect.arrayContaining([
      { stock_kind: "FULL_JAR", quantity: 20 },
      { stock_kind: "EMPTY_JAR", quantity: 65 },
      { stock_kind: "BOTTLE_CARTON", quantity: 10 },
    ]),
  );
  expect(
    await scalar(
      "select count(*) from public.stock_movements where movement_type='TRIP_RETURN'",
    ),
  ).toBe(3);
  expect(
    await scalar(
      "select count(*) from public.delivery_payment_intents where settlement_state='PENDING_SPRINT3'",
    ),
  ).toBe(2);
  await rpc("create_trip", [
    randomUUID(),
    driver,
    vehicle,
    day,
    "[]",
    "",
    randomUUID(),
  ]);
});
it("rejects overloading and conflicting assignments atomically", async () => {
  await rejects(
    "load_trip",
    [
      trip,
      JSON.stringify([
        { product_id: jar, stock_kind: "FULL_JAR", quantity: 101 },
      ]),
      randomUUID(),
    ],
    /Insufficient/,
  );
  expect(await scalar("select count(*) from public.trip_load_items")).toBe(0);
  await rejects(
    "create_trip",
    [randomUUID(), driver, vehicle, day, "[]", "", randomUUID()],
    /unique/,
  );
});
it("prevents overdelivery, altered retries and direct writes", async () => {
  await active();
  await rejects(
    "post_trip_visit",
    [
      trip,
      customer,
      "",
      "",
      items(101, 0),
      '{"selection":"CASH"}',
      "",
      randomUUID(),
    ],
    /Insufficient/,
  );
  expect(await scalar("select count(*) from public.trip_visits")).toBe(0);
  const key = randomUUID();
  await visit(10, 5, key);
  await rejects(
    "post_trip_visit",
    [trip, customer, "", "", items(11, 5), '{"selection":"CASH"}', "", key],
    /Idempotency/,
  );
  await db.exec("savepoint denied");
  await expect(
    db.exec("update public.inventory_balances set quantity=999"),
  ).rejects.toThrow(/permission/);
  await db.exec("rollback to savepoint denied");
});
it("isolates drivers and denies warehouse adjustments, loading, closure and customer management", async () => {
  await active();
  await who(other);
  expect(await scalar("select count(*) from public.trips")).toBe(0);
  expect(await scalar("select count(*) from public.customers")).toBe(0);
  await rejects("transition_trip", [trip, "START", "", randomUUID()], /access/);
  await who(driver);
  expect(
    await scalar(
      "select count(*) from public.stock_locations where kind='WAREHOUSE'",
    ),
  ).toBe(0);
  await rejects(
    "adjust_warehouse_stock",
    [jar, "FULL_JAR", 1, "Forbidden change", "", day, randomUUID()],
    /admin/i,
  );
  await rejects("load_trip", [trip, "[]", randomUUID()], /authorized/);
  await rejects(
    "reconcile_trip",
    [trip, counts(), "Forbidden close", true, randomUUID()],
    /authorized/,
  );
  await rejects(
    "save_customer",
    [randomUUID(), "New", "", "", "", "", true, 0, "Forbidden", randomUUID()],
    /authorized/,
  );
});
it("holds discrepancies without stock changes, then explicitly approves variance", async () => {
  await active();
  await visit(80, 65);
  await rpc("submit_trip", [trip, counts(), randomUUID()]);
  await who(admin);
  await rpc("reconcile_trip", [
    trip,
    counts(19, 64),
    "Physical discrepancy",
    false,
    randomUUID(),
  ]);
  expect(await scalar("select status from public.trips")).toBe("DISCREPANCY");
  expect(
    await scalar(
      "select count(*) from public.stock_movements where movement_type='TRIP_RETURN'",
    ),
  ).toBe(0);
  await rpc("transition_trip", [
    trip,
    "REVIEW",
    "Review variance",
    randomUUID(),
  ]);
  await rpc("reconcile_trip", [
    trip,
    counts(19, 64),
    "Approved counted shortages",
    true,
    randomUUID(),
  ]);
  expect(
    await scalar(
      "select count(*) from public.stock_movements where movement_type='VARIANCE_LOSS'",
    ),
  ).toBe(2);
  expect(await scalar("select status from public.trips")).toBe("CLOSED");
});
it("rejects invalid states, incomplete counts and edits to immutable journals", async () => {
  await rejects(
    "transition_trip",
    [trip, "START", "", randomUUID()],
    /current state/i,
  );
  await active();
  await rejects("submit_trip", [trip, "[]", randomUUID()], /every/);
  await visit();
  await db.exec("reset role; savepoint immutable");
  await expect(
    db.exec("update public.trip_visits set notes='rewrite'"),
  ).rejects.toThrow(/immutable/i);
  await db.exec("rollback to savepoint immutable");
});
it("keeps walk-in exchanges balanced and rejects unregistered credit", async () => {
  await active();
  await rejects(
    "post_trip_visit",
    [
      trip,
      null,
      "Walk in",
      "",
      items(10, 0),
      '{"selection":"CASH"}',
      "",
      randomUUID(),
    ],
    /equal empty/,
  );
  await rpc("post_trip_visit", [
    trip,
    null,
    "Walk in",
    "",
    items(10, 10),
    '{"selection":"FONEPAY","verified":true}',
    "",
    randomUUID(),
  ]);
  expect(
    await scalar(
      "select settlement_state from public.delivery_payment_intents",
    ),
  ).toBe("PENDING_SPRINT3");
  await rejects(
    "post_trip_visit",
    [
      trip,
      null,
      "Walk in",
      "",
      items(1, 1),
      '{"selection":"UNPAID"}',
      "",
      randomUUID(),
    ],
    /Registered/,
  );
});
it("records legacy customer custody separately and rolls back invalid financial instructions", async () => {
  await rpc("adjust_customer_custody", [
    customer,
    jar,
    20,
    day,
    "Verified legacy jar holding",
    randomUUID(),
  ]);
  await active();
  await rpc("post_trip_visit", [
    trip,
    customer,
    "",
    "",
    items(0, 15),
    '{"selection":"CASH"}',
    "",
    randomUUID(),
  ]);
  expect(await scalar("select quantity from public.jar_custody_balances")).toBe(
    5,
  );
  await rejects(
    "post_trip_visit",
    [
      trip,
      customer,
      "",
      "",
      items(10, 0),
      '{"selection":"PARTIAL","reported_amount":"2000"}',
      "",
      randomUUID(),
    ],
    /Partial/,
  );
  expect(await scalar("select count(*) from public.trip_visits")).toBe(1);
});
it("loads an RLS-scoped workspace with exact price strings", async () => {
  await active();
  await visit();
  const workspace = (await scalar("select public.operations_workspace($1)", [
    trip,
  ])) as {
    products: { default_price: string }[];
    visits: { value_snapshot: string }[];
    trips: unknown[];
  };
  expect(workspace.products[0]!.default_price).toBe("150.25");
  expect(workspace.visits[0]!.value_snapshot).toBe("6010.00");
  expect(workspace.trips).toHaveLength(1);
  await who(other);
  expect(
    (
      (await scalar("select public.operations_workspace($1)", [trip])) as {
        trips: unknown[];
      }
    ).trips,
  ).toHaveLength(0);
});
it("delivers cartons and snapshots server prices, with no jar custody changes", async () => {
  await active();
  await rpc("post_trip_visit", [
    trip,
    customer,
    "",
    "",
    JSON.stringify([
      {
        product_id: carton,
        full_jars: 0,
        empty_jars: 0,
        cartons: 4,
        price: "0.01",
      },
    ]),
    '{"selection":"PARTIAL","reported_amount":"100.10"}',
    "",
    randomUUID(),
  ]);
  expect(
    await scalar("select unit_price_snapshot::text from public.visit_items"),
  ).toBe("150.25");
  expect(
    await scalar("select value::text from public.delivery_value_snapshots"),
  ).toBe("601.00");
  expect(await scalar("select count(*) from public.jar_custody_entries")).toBe(
    0,
  );
});
it("blocks deactivation of assigned driver and vehicle without changing their roles", async () => {
  await rejects(
    "save_driver",
    [driver, "Driver", false, 1, "Disable driver", randomUUID()],
    /assigned trip/,
  );
  await rejects(
    "save_vehicle",
    [vehicle, "TEST-001", "", false, 1, "Disable vehicle", randomUUID()],
    /assigned trip/,
  );
  await rpc("transition_trip", [
    trip,
    "CANCEL",
    "Cancel draft safely",
    randomUUID(),
  ]);
  await rpc("save_driver", [
    driver,
    "Driver",
    false,
    1,
    "Deactivate after cancellation",
    randomUUID(),
  ]);
  expect(
    await scalar("select role from public.profiles where id=$1", [driver]),
  ).toBe("DRIVER");
});
it("records surplus as explicit variance gain and preserves prior discrepancy evidence", async () => {
  await active();
  await visit(80, 65);
  await rpc("submit_trip", [trip, counts(), randomUUID()]);
  await who(admin);
  await rpc("reconcile_trip", [
    trip,
    counts(21, 66),
    "Verified physical surplus",
    true,
    randomUUID(),
  ]);
  expect(
    await scalar(
      "select count(*) from public.stock_movements where movement_type='VARIANCE_GAIN'",
    ),
  ).toBe(2);
  expect(
    await scalar(
      "select count(*) from public.trip_discrepancies where approved_by is not null",
    ),
  ).toBe(2);
  await db.exec("reset role; savepoint closed");
  await expect(
    db.exec("update public.trips set notes='rewrite'"),
  ).rejects.toThrow(/Closed trips/);
  await db.exec("rollback to savepoint closed");
});
it("locks operations to their explicit business day and preserves the trip after day close", async () => {
  await active();
  await db.exec("reset role");
  await db.query(
    "update public.business_days set status='CLOSING_REVIEW' where id=$1",
    [day],
  );
  await who(driver);
  await rejects(
    "post_trip_visit",
    [trip, customer, "", "", items(), '{"selection":"CASH"}', "", randomUUID()],
    /OPEN/,
  );
  expect(await scalar("select count(*) from public.trips")).toBe(1);
});
it("supports independent simultaneous drivers and vehicles, while separating route data", async () => {
  const secondVehicle = randomUUID(),
    secondCustomer = randomUUID(),
    secondTrip = randomUUID();
  await rpc("save_vehicle", [
    secondVehicle,
    "TEST-002",
    "",
    true,
    0,
    "Second vehicle",
    randomUUID(),
  ]);
  await rpc("save_customer", [
    secondCustomer,
    "Second customer",
    "",
    "",
    "",
    "",
    true,
    0,
    "Second route",
    randomUUID(),
  ]);
  await rpc("create_trip", [
    secondTrip,
    other,
    secondVehicle,
    day,
    JSON.stringify([secondCustomer]),
    "",
    randomUUID(),
  ]);
  await active();
  await who(other);
  expect(await scalar("select count(*) from public.trips")).toBe(1);
  expect(await scalar("select name from public.customers")).toBe(
    "Second customer",
  );
  await rejects(
    "post_trip_visit",
    [trip, customer, "", "", items(), '{"selection":"CASH"}', "", randomUUID()],
    /access/,
  );
});
it("denies anonymous and disabled identities and direct sequence manipulation", async () => {
  await db.exec("savepoint sequence");
  await expect(
    db.exec("select nextval('public.trips_trip_number_seq')"),
  ).rejects.toThrow(/permission/);
  await db.exec("rollback to savepoint sequence");
  await db.exec("reset role");
  await db.query("update public.profiles set is_active=false where id=$1", [
    driver,
  ]);
  await who(driver);
  expect(await scalar("select count(*) from public.trips")).toBe(0);
  await rejects(
    "transition_trip",
    [trip, "START", "", randomUUID()],
    /authorized/,
  );
  await db.exec("set role anon; savepoint anonymous");
  await expect(
    db.exec("select public.operations_workspace(null)"),
  ).rejects.toThrow(/permission/);
  await db.exec("rollback to savepoint anonymous");
});
