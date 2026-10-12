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
    "insert into public.profiles(id,name,role,approval_status) values($1,'Admin', 'ADMIN','APPROVED'),($2,'Driver', 'DRIVER','APPROVED'),($3,'Other', 'DRIVER','APPROVED')",
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
it("keeps trip ownership isolated and unlocks the active customer directory only during operations", async () => {
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
    "[]",
    "",
    randomUUID(),
  ]);
  await active();
  await who(other);
  expect(await scalar("select count(*) from public.trips")).toBe(1);
  expect(await scalar("select count(*) from public.customers")).toBe(0);
  await rejects(
    "post_trip_visit",
    [trip, customer, "", "", items(), '{"selection":"CASH"}', "", randomUUID()],
    /access/,
  );
  await who(driver);
  expect(
    (
      (await rpc("operations_workspace", [trip])) as unknown as {
        customers: unknown[];
      }
    ).customers,
  ).toHaveLength(2);
  expect(await scalar("select count(*) from public.customers")).toBe(0);
  expect(await scalar("select count(*) from public.trips")).toBe(1);
});
it("denies anonymous and disabled identities and direct sequence manipulation", async () => {
  await db.exec("savepoint sequence");
  await expect(
    db.exec("select nextval('public.trips_trip_number_seq')"),
  ).rejects.toThrow(/permission/);
  await db.exec("rollback to savepoint sequence");
  await db.exec("reset role");
  await db.query(
    "update public.profiles set is_active=false,approval_status='SUSPENDED' where id=$1",
    [driver],
  );
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

// Capture every physical effect, including request/audit rows, rather than only
// asserting a failed RPC's error text. Read as the isolated database owner:
// request journals are intentionally inaccessible even to application admins.
async function physicalSnapshot() {
  await db.exec("reset role");
  const result = await scalar(`select jsonb_build_object(
    'balances',(select jsonb_agg(to_jsonb(b) order by location_id,product_id,stock_kind) from public.inventory_balances b),
    'custody',(select jsonb_agg(to_jsonb(c) order by customer_id,product_id) from public.jar_custody_balances c),
    'trips',(select jsonb_agg(to_jsonb(t) order by id) from public.trips t),
    'movements',(select count(*) from public.stock_movements),
    'loads',(select count(*) from public.trip_load_items),
    'visits',(select count(*) from public.trip_visits),
    'items',(select count(*) from public.visit_items),
    'custody_entries',(select count(*) from public.jar_custody_entries),
    'values',(select count(*) from public.delivery_value_snapshots),
    'payments',(select count(*) from public.delivery_payment_intents),
    'declarations',(select count(*) from public.trip_return_declarations),
    'checks',(select count(*) from public.trip_return_checks),
    'check_items',(select count(*) from public.trip_return_check_items),
    'discrepancies',(select count(*) from public.trip_discrepancies),
    'requests',(select count(*) from public.operation_requests),
    'audit',(select count(*) from public.audit_events))`);
  await db.exec("set role authenticated");
  return result;
}
it("rolls back earlier load lines when a later product is out of stock", async () => {
  const before = await physicalSnapshot();
  // SQL sorts product IDs; make the first line valid and the second too large.
  const loadItems = [
    { product_id: jar, stock_kind: "FULL_JAR", quantity: 1 },
    { product_id: carton, stock_kind: "BOTTLE_CARTON", quantity: 1 },
  ].sort((a, b) => a.product_id.localeCompare(b.product_id));
  loadItems[1]!.quantity = 101;
  await rejects(
    "load_trip",
    [trip, JSON.stringify(loadItems), randomUUID()],
    /Insufficient/,
  );
  expect(await physicalSnapshot()).toEqual(before);
});
it("rolls back all visit effects when a later line cannot be delivered", async () => {
  await active();
  await who(admin);
  const before = await physicalSnapshot();
  const lines = [
    { product_id: jar, full_jars: 1, empty_jars: 1, cartons: 0 },
    { product_id: carton, full_jars: 0, empty_jars: 0, cartons: 1 },
  ].sort((a, b) => a.product_id.localeCompare(b.product_id));
  if (lines[1]!.product_id === jar) lines[1]!.full_jars = 101;
  else lines[1]!.cartons = 11;
  await who(driver);
  await rejects(
    "post_trip_visit",
    [
      trip,
      customer,
      "",
      "",
      JSON.stringify(lines),
      '{"selection":"CASH"}',
      "",
      randomUUID(),
    ],
    /Insufficient/,
  );
  await who(admin);
  expect(await physicalSnapshot()).toEqual(before);
});
it.each([-1, 1.5, 2147483648, null])(
  "rejects invalid delivery quantity %s without ledger changes",
  async (quantity) => {
    await active();
    await who(admin);
    const before = await physicalSnapshot();
    await who(driver);
    await rejects(
      "post_trip_visit",
      [
        trip,
        customer,
        "",
        "",
        JSON.stringify([
          { product_id: jar, full_jars: quantity, empty_jars: 0, cartons: 0 },
        ]),
        '{"selection":"CASH"}',
        "",
        randomUUID(),
      ],
      /whole|integer|range/i,
    );
    await who(admin);
    expect(await physicalSnapshot()).toEqual(before);
  },
);
it("retries the entire completed trip without adding any physical or audit effects", async () => {
  const loadKey = randomUUID(),
    startKey = randomUUID(),
    visitKey = randomUUID(),
    submitKey = randomUUID(),
    closeKey = randomUUID();
  const loadLines = JSON.stringify([
    { product_id: jar, stock_kind: "FULL_JAR", quantity: 100 },
    { product_id: carton, stock_kind: "BOTTLE_CARTON", quantity: 10 },
  ]);
  await rpc("load_trip", [trip, loadLines, loadKey]);
  await who(driver);
  await rpc("transition_trip", [trip, "START", "", startKey]);
  const visitId = await visit(80, 65, visitKey);
  await rpc("submit_trip", [trip, counts(), submitKey]);
  await who(admin);
  await rpc("reconcile_trip", [
    trip,
    counts(),
    "Verified physical return",
    false,
    closeKey,
  ]);
  const before = await physicalSnapshot();
  expect(await rpc("load_trip", [trip, loadLines, loadKey])).toBe(trip);
  expect(
    await rpc("reconcile_trip", [
      trip,
      counts(),
      "Verified physical return",
      false,
      closeKey,
    ]),
  ).toBe(trip);
  await who(driver);
  expect(await rpc("transition_trip", [trip, "START", "", startKey])).toBe(
    trip,
  );
  expect(await visit(80, 65, visitKey)).toBe(visitId);
  expect(await rpc("submit_trip", [trip, counts(), submitKey])).toBe(trip);
  await rejects("submit_trip", [trip, counts(), randomUUID()], /active trip/);
  await who(admin);
  await rejects(
    "reconcile_trip",
    [trip, counts(), "Repeated with new key", false, randomUUID()],
    /submitted trip/,
  );
  expect(await physicalSnapshot()).toEqual(before);
});
it("reconstructs every warehouse/vehicle balance from its immutable journal and links actors, days and audits", async () => {
  await active();
  await visit(40, 30);
  await visit(40, 35);
  await rpc("submit_trip", [trip, counts(), randomUUID()]);
  await who(admin);
  await rpc("reconcile_trip", [
    trip,
    counts(),
    "Audited physical return",
    false,
    randomUUID(),
  ]);
  await db.exec("reset role");
  expect(
    await scalar(`select count(*) from public.inventory_balances b where b.quantity <> coalesce((
    select sum(case when m.to_location_id=b.location_id then m.quantity::bigint else -m.quantity::bigint end)
    from public.stock_movements m where m.product_id=b.product_id and m.stock_kind=b.stock_kind
      and b.location_id in(m.from_location_id,m.to_location_id)),0)`),
  ).toBe(0);
  expect(
    await scalar(
      "select count(*) from public.inventory_balances b join public.vehicles v on v.location_id=b.location_id where b.quantity<>0",
    ),
  ).toBe(0);
  expect(
    await scalar(
      `select count(*) from public.stock_movements m where m.trip_id=$1 and (
    m.business_day_id<>$2 or m.actor_user_id not in($3,$4)
    or (m.from_location_id is not null and (m.from_quantity_before is null or m.from_quantity_after<>m.from_quantity_before-m.quantity))
    or (m.to_location_id is not null and (m.to_quantity_before is null or m.to_quantity_after<>m.to_quantity_before+m.quantity))
    or not exists(select 1 from public.operation_requests r where r.actor_user_id=m.actor_user_id and r.idempotency_key=m.idempotency_key))`,
      [trip, day, admin, driver],
    ),
  ).toBe(0);
  expect(
    await scalar(`select count(*) from public.trip_visits v where not exists(
    select 1 from public.audit_events a where a.entity='trip_visits' and a.entity_id=v.id and a.actor_user_id=v.actor_user_id and a.action='DELIVERY_POSTED')`),
  ).toBe(0);
  const actions = (
    await db.query<{ action: string }>(
      "select action from public.audit_events where entity='trips' and entity_id=$1",
      [trip],
    )
  ).rows.map((r) => r.action);
  expect(actions).toEqual(
    expect.arrayContaining([
      "TRIP_CREATED",
      "TRIP_LOADED",
      "TRIP_START",
      "TRIP_SUBMITTED",
      "TRIP_CLOSED",
    ]),
  );
  expect(
    await scalar(
      "select count(*) from public.jar_custody_balances b where b.quantity<>(select sum(delta) from public.jar_custody_entries e where e.customer_id=b.customer_id and e.product_id=b.product_id)",
    ),
  ).toBe(0);
});
it("preserves all inventory when return counts contain duplicates or an unknown stock line", async () => {
  await active();
  await visit(80, 65);
  await who(admin);
  const before = await physicalSnapshot();
  await who(driver);
  for (const invalid of [
    JSON.stringify([...JSON.parse(counts()), JSON.parse(counts())[0]]),
    JSON.stringify([
      { product_id: randomUUID(), stock_kind: "FULL_JAR", quantity: 0 },
      ...JSON.parse(counts()).slice(1),
    ]),
  ])
    await rejects("submit_trip", [trip, invalid, randomUUID()], /every/);
  await who(admin);
  expect(await physicalSnapshot()).toEqual(before);
});
it("denies admin master-data operations while allowing driver-selected active customers", async () => {
  const unassigned = randomUUID();
  await rpc("save_customer", [
    unassigned,
    "Unassigned",
    "",
    "",
    "",
    "",
    true,
    0,
    "Other route",
    randomUUID(),
  ]);
  await active();
  await rejects(
    "save_vehicle",
    [randomUUID(), "FORBIDDEN", "", true, 0, "Forbidden", randomUUID()],
    /authorized/,
  );
  await rejects(
    "save_driver",
    [other, "Changed", true, 1, "Forbidden", randomUUID()],
    /authorized/,
  );
  await rejects(
    "create_trip",
    [randomUUID(), driver, vehicle, day, "[]", "", randomUUID()],
    /authorized/,
  );
  await rejects(
    "assign_trip_customer",
    [trip, unassigned, randomUUID()],
    /authorized/,
  );
  await rejects(
    "adjust_customer_custody",
    [customer, jar, 1, day, "Forbidden", randomUUID()],
    /authorized/,
  );
  await rejects(
    "transition_trip",
    [trip, "CANCEL", "Forbidden", randomUUID()],
    /authorized/,
  );
  await rpc("post_trip_visit", [
    trip,
    unassigned,
    "",
    "",
    items(1, 0),
    '{"selection":"CASH"}',
    "",
    randomUUID(),
  ]);
  expect(await scalar("select count(*) from public.trip_visits")).toBe(1);
});
