import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID, createHash } from "node:crypto";
import { beforeAll, afterAll, beforeEach, afterEach, it, expect } from "vitest";
import type { Workspace } from "@/domain/operations/types";
import type { DayDetail } from "@/domain/business-days/types";
let db: PGlite, day: string, tomorrow: string;
const admin = randomUUID(),
  driverA = randomUUID(),
  driverB = randomUUID(),
  vehicleA = randomUUID(),
  vehicleB = randomUUID(),
  jar = randomUUID(),
  customerA = randomUUID(),
  customerB = randomUUID();
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
async function rejected(name: string, args: unknown[], match: RegExp) {
  await db.exec("savepoint denied");
  await expect(rpc(name, args)).rejects.toThrow(match);
  await db.exec("rollback to savepoint denied");
}
const report = (id = day) => rpc<DayDetail>("business_day_report", [id]);
const workspace = (trip: string | null = null) =>
  rpc<Workspace>("operations_workspace", [trip]);
const loadItems = (quantity: number) =>
  JSON.stringify([{ product_id: jar, stock_kind: "FULL_JAR", quantity }]);
const counts = (quantity: number, empty = 0) =>
  JSON.stringify([
    { product_id: jar, stock_kind: "FULL_JAR", quantity },
    { product_id: jar, stock_kind: "EMPTY_JAR", quantity: empty },
  ]);
async function schedule(driver = driverA, vehicle = vehicleA, date = tomorrow) {
  const trip = randomUUID();
  await rpc("schedule_trip", [
    trip,
    driver,
    vehicle,
    day,
    date,
    "Night load",
    randomUUID(),
  ]);
  return trip;
}
async function prepare(quantity = 85, driver = driverA, vehicle = vehicleA) {
  const trip = await schedule(driver, vehicle);
  await rpc("load_trip", [trip, loadItems(quantity), randomUUID()]);
  return trip;
}
async function close() {
  const version = (await report()).report.day.version;
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
      cash_counted: "0",
      notes: "Checked physical warehouse and prepared vehicle counts",
      cash_checked: true,
      fonepay_checked: true,
      stock_checked: true,
      balances_checked: true,
      confirmed: true,
    }),
    randomUUID(),
  ]);
}
async function nextDay() {
  day = await rpc("open_inventory_business_day", [randomUUID()]);
  await db.exec("reset role");
  await db.query("update public.business_days set date_label=$1 where id=$2", [
    tomorrow,
    day,
  ]);
  // Only this transaction's disposable fixture clock advances; no hosted data.
  await db.exec(
    `create or replace function public.trip_nepal_date() returns date language sql volatile set search_path='' as $$select '${tomorrow}'::date$$`,
  );
  await who();
}
const action = (trip: string, type: string, reason = "", key = randomUUID()) =>
  rpc("transition_trip", [trip, type, reason, key]);
const prepAction = (
  trip: string,
  type: string,
  date: string | null = null,
  returned: string | null = null,
  key = randomUUID(),
) =>
  rpc("trip_preparation_command", [
    trip,
    type,
    date,
    "Inspected authorized physical operation",
    returned,
    key,
  ]);
async function visit(
  trip: string,
  customer: string,
  quantity: number,
  empty = 0,
) {
  return rpc("post_driver_delivery", [
    trip,
    customer,
    "",
    "",
    JSON.stringify([
      { product_id: jar, full_jars: quantity, empty_jars: empty, cartons: 0 },
    ]),
    "CREDIT",
    null,
    "",
    randomUUID(),
  ]);
}
async function quantity(location: string, kind = "FULL_JAR") {
  return (
    (await workspace()).balances.find(
      (b) =>
        b.location_id === location &&
        b.product_id === jar &&
        b.stock_kind === kind,
    )?.quantity ?? 0
  );
}
async function locations() {
  const w = await workspace();
  return {
    main: w.locations.find((l) => l.code === "MAIN")!.id,
    a: w.vehicles.find((v) => v.id === vehicleA)!.location_id,
    b: w.vehicles.find((v) => v.id === vehicleB)!.location_id,
  };
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;`);
  for (const f of readdirSync("supabase/migrations").sort())
    await db.exec(readFileSync(`supabase/migrations/${f}`, "utf8"));
  for (const [id, name, role] of [
    [admin, "Admin", "ADMIN"],
    [driverA, "A", "DRIVER"],
    [driverB, "B", "DRIVER"],
  ]) {
    await db.query("insert into auth.users values($1)", [id]);
    await db.query(
      "insert into public.profiles(id,name,role,approval_status) values($1,$2,$3,'APPROVED')",
      [id, name, role],
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
    "JAR",
    "Water jar",
    "FULL_JAR",
    "jar",
    "100",
    true,
    0,
    "Isolated fixture",
    randomUUID(),
  ]);
  day = await rpc("open_inventory_business_day", [randomUUID()]);
  const date = (await report()).report.day.date_label;
  tomorrow = new Date(Date.parse(date) + 86400000).toISOString().slice(0, 10);
  // Prove the UAT refill function is reused: 170 empties -> 170 eligible full.
  await rpc("adjust_warehouse_stock", [
    jar,
    "EMPTY_JAR",
    170,
    "Fixture opening stock",
    "",
    day,
    randomUUID(),
  ]);
  await rpc("process_warehouse_jars", [
    day,
    jar,
    "REFILL",
    "EMPTY_JAR",
    170,
    "Completed eligible refill",
    randomUUID(),
  ]);
  for (const [id, plate] of [
    [vehicleA, "A-85"],
    [vehicleB, "B-65"],
  ])
    await rpc("save_vehicle", [
      id,
      plate,
      "",
      true,
      0,
      "Isolated fixture",
      randomUUID(),
    ]);
  for (const [id, name] of [
    [customerA, "Customer A"],
    [customerB, "Customer B"],
  ])
    await rpc("save_customer", [
      id,
      name,
      "",
      "",
      "",
      "",
      true,
      0,
      "Isolated fixture",
      randomUUID(),
    ]);
});
afterEach(async () => {
  await db.exec("rollback;reset role");
});

it("a returned trip still owns the driver assignment until warehouse confirmation; confirmation permits the next load", async () => {
  const trip = randomUUID();
  await rpc("create_trip", [
    trip,
    driverA,
    vehicleA,
    day,
    [],
    "",
    randomUUID(),
  ]);
  await rpc("load_trip", [trip, loadItems(85), randomUUID()]);
  await who(driverA);
  await action(trip, "START");
  await rpc("submit_trip", [trip, counts(85), randomUUID()]);
  await who();
  expect((await workspace(trip)).trips.find((t) => t.id === trip)?.status).toBe(
    "SUBMITTED",
  );
  await rejected(
    "create_trip",
    [randomUUID(), driverA, vehicleB, day, [], "", randomUUID()],
    /one_live_trip_per_driver|unique/i,
  );
  await rpc("reconcile_trip", [
    trip,
    counts(85),
    "Warehouse confirmed all returns",
    false,
    randomUUID(),
  ]);
  const next = randomUUID();
  await rpc("create_trip", [
    next,
    driverA,
    vehicleB,
    day,
    [],
    "",
    randomUUID(),
  ]);
  await rpc("load_trip", [next, loadItems(40), randomUUID()]);
  await who(driverA);
  await action(next, "START");
  expect((await workspace(next)).trips.find((t) => t.id === next)?.status).toBe(
    "ACTIVE",
  );
});

it("prepares all customer contexts for an assigned LOADED trip without permitting deliveries", async () => {
  const trip = await prepare();
  await who(driverA);
  const contexts = await rpc<
    { customer: { id: string }; pending_jars: unknown[]; credit: unknown[] }[]
  >("offline_contexts", [trip]);
  expect(contexts.map((c) => c.customer.id)).toEqual(
    expect.arrayContaining([customerA, customerB]),
  );
  expect(contexts[0]!.credit).toEqual([]);
  expect(contexts[0]!.pending_jars).toEqual([]);
  await rejected(
    "post_driver_delivery",
    [
      trip,
      customerA,
      "",
      "",
      JSON.stringify([
        { product_id: jar, full_jars: 1, empty_jars: 0, cartons: 0 },
      ]),
      "CREDIT",
      null,
      "",
      randomUUID(),
    ],
    /active|start/i,
  );
  await who(driverB);
  await rejected("offline_contexts", [trip], /Assigned trip/);
});
it("reproduces the old closing conflict and completes 170 -> 85/65/20, next-day 50/30 deliveries and verified returns", async () => {
  const a = await prepare(),
    b = await prepare(65, driverB, vehicleB),
    loc = await locations(),
    firstDay = day;
  expect(await quantity(loc.main)).toBe(20);
  expect(await quantity(loc.a)).toBe(85);
  expect(await quantity(loc.b)).toBe(65);
  await db.exec("reset role");
  const previous = (
    await db.query<{ value: { code: string }[] }>(
      "select public.day_blockers_before_schedule($1) as value",
      [day],
    )
  ).rows[0]!.value;
  expect(previous.filter((b) => b.code === "TRIP")).toHaveLength(2);
  expect(previous.filter((b) => b.code === "VEHICLE_STOCK")).toHaveLength(2);
  await who();
  expect((await report()).blockers).toEqual([]);
  expect((await report()).report).toMatchObject({
    totals: { sales: "0", trips: 0 },
    prepared_trips: [{ full_jars: 85 }, { full_jars: 65 }],
  });
  await close();
  const archive = (await report()).report;
  expect(archive.prepared_trips?.reduce((n, t) => n + t.full_jars, 0)).toBe(
    150,
  );
  expect((await workspace(a)).trips[0]).toMatchObject({
    status: "LOADED",
    scheduled_date: tomorrow,
    loading_business_day_id: firstDay,
    loaded_by: admin,
  });
  await nextDay();
  await who(driverA);
  expect((await workspace(a)).days).toContainEqual(
    expect.objectContaining({ id: day, status: "OPEN" }),
  );
  await action(a, "START");
  await visit(a, customerA, 50, 15);
  await who(driverB);
  await action(b, "START");
  await visit(b, customerB, 30, 10);
  await who();
  expect(await quantity(loc.main)).toBe(20);
  expect(await quantity(loc.a)).toBe(35);
  expect(await quantity(loc.b)).toBe(35);
  expect((await report()).report.totals).toMatchObject({
    full_jars: 80,
    empty_jars: 25,
    sales: "8000.00",
  });
  expect((await report(firstDay)).report).toEqual(archive);
  for (const [trip, driver, empty] of [
    [a, driverA, 15],
    [b, driverB, 10],
  ] as const) {
    await who(driver);
    await rpc("submit_trip", [trip, counts(35, empty), randomUUID()]);
    await who();
    await rpc("reconcile_trip", [
      trip,
      counts(35, empty),
      "Physically verified returns",
      false,
      randomUUID(),
    ]);
  }
  expect(await quantity(loc.main)).toBe(90);
  expect(await quantity(loc.main, "EMPTY_JAR")).toBe(25);
  const movements = [
    ...(await workspace(a)).movements,
    ...(await workspace(b)).movements,
  ];
  expect(movements.filter((m) => m.movement_type === "TRIP_LOAD")).toHaveLength(
    2,
  );
  expect(
    movements
      .filter((m) => m.movement_type === "TRIP_LOAD")
      .every((m) => m.business_day_id === firstDay),
  ).toBe(true);
  expect(
    movements
      .filter((m) => m.movement_type === "DELIVERY")
      .every((m) => m.business_day_id === day),
  ).toBe(true);
  await close();
});
it("draft scheduling changes no stock, cannot start early and loading retries deduct exactly once", async () => {
  const trip = await schedule(),
    loc = await locations();
  expect(await quantity(loc.main)).toBe(170);
  const key = randomUUID();
  await rpc("load_trip", [trip, loadItems(85), key]);
  const loaded = (await workspace(trip)).trips[0]!;
  await rpc("load_trip", [trip, loadItems(85), key]);
  expect((await workspace(trip)).trips[0]!.loaded_at).toBe(loaded.loaded_at);
  await rejected(
    "load_trip",
    [trip, loadItems(85), randomUUID()],
    /Only a draft/,
  );
  await who(driverA);
  await rejected(
    "transition_trip",
    [trip, "START", "", randomUUID()],
    /scheduled/,
  );
  await who();
  expect(await quantity(loc.main)).toBe(85);
  expect(
    (await workspace(trip)).movements.filter(
      (m) => m.movement_type === "TRIP_LOAD",
    ),
  ).toHaveLength(1);
});
it("a prepared device snapshot reserves no extra stock and does not block night closing; only the confirmed start activates its writer", async () => {
  const trip = await prepare(),
    device = randomUUID(),
    token = "e".repeat(64);
  await who(driverA);
  expect(await rpc("offline_register", [trip, device, token])).toMatchObject({
    phase: "PREPARED",
  });
  await who();
  expect((await report()).blockers).toEqual([]);
  await close();
  await nextDay();
  await who(driverA);
  await action(trip, "START");
  expect(await rpc("offline_read_state", [trip, device, token])).toMatchObject({
    round: { phase: "ACTIVE", confirmed_sequence: 0 },
  });
  await who();
  expect((await workspace(trip)).loads[0]!.quantity).toBe(85);
  expect(
    (await workspace(trip)).movements.filter(
      (m) => m.movement_type === "TRIP_LOAD",
    ),
  ).toHaveLength(1);
});
it("rejects over-allocation atomically and keeps conflicting driver/vehicle assignments unique", async () => {
  await prepare(100);
  const b = await schedule(driverB, vehicleB),
    loc = await locations();
  await rejected(
    "load_trip",
    [b, loadItems(71), randomUUID()],
    /Insufficient stock/,
  );
  expect((await workspace(b)).trips[0]!.status).toBe("DRAFT");
  expect((await workspace(b)).loads).toEqual([]);
  expect(await quantity(loc.main)).toBe(70);
  await rejected(
    "schedule_trip",
    [randomUUID(), driverA, vehicleB, day, tomorrow, "", randomUUID()],
    /duplicate|reconciled/,
  );
  await rejected(
    "schedule_trip",
    [randomUUID(), driverB, vehicleA, day, tomorrow, "", randomUUID()],
    /duplicate|reconciled/,
  );
});
it("a future draft survives closing and a later physical load posts to the new loading day", async () => {
  const trip = await schedule(),
    first = day;
  await close();
  await nextDay();
  await rpc("load_trip", [trip, loadItems(85), randomUUID()]);
  const w = await workspace(trip);
  expect(w.trips[0]).toMatchObject({
    status: "LOADED",
    created_business_day_id: first,
    loading_business_day_id: day,
  });
  expect(
    w.movements.filter((m) => m.movement_type === "TRIP_LOAD")[0]!
      .business_day_id,
  ).toBe(day);
  await who(driverA);
  await action(trip, "START");
  await who();
  expect(
    (await workspace(trip)).movements.filter(
      (m) => m.movement_type === "TRIP_LOAD",
    ),
  ).toHaveLength(1);
});
it("reschedules the same prepared trip without moving stock, and physical unloading cancellation is exact and idempotent", async () => {
  const a = await prepare(),
    loc = await locations(),
    next = new Date(Date.parse(tomorrow) + 86400000).toISOString().slice(0, 10);
  await prepAction(a, "RESCHEDULE", next);
  expect((await workspace(a)).trips[0]!.scheduled_date).toBe(next);
  expect(await quantity(loc.main)).toBe(85);
  await rejected(
    "transition_trip",
    [a, "CANCEL", "Cancel prepared trip", randomUUID()],
    /not allowed/,
  );
  await rejected(
    "trip_preparation_command",
    [
      a,
      "UNLOAD_CANCEL",
      null,
      "Physical counts checked",
      counts(84),
      randomUUID(),
    ],
    /do not match/,
  );
  expect(await quantity(loc.main)).toBe(85);
  const key = randomUUID();
  await prepAction(a, "UNLOAD_CANCEL", null, counts(85), key);
  await prepAction(a, "UNLOAD_CANCEL", null, counts(85), key);
  expect(await quantity(loc.main)).toBe(170);
  expect(await quantity(loc.a)).toBe(0);
  const w = await workspace(a);
  expect(w.trips[0]).toMatchObject({ status: "CLOSED", cancelled: true });
  expect(w.loads[0]!.quantity).toBe(85);
  expect(
    w.movements.filter((m) => m.movement_type === "TRIP_UNLOAD"),
  ).toHaveLength(1);
  expect((await report()).blockers).toEqual([]);
});
it("requires an audited carryover, pauses operations and resumes the same trip with period-specific sales", async () => {
  const date = (await report()).report.day.date_label;
  const trip = await schedule(driverA, vehicleA, date);
  await rpc("load_trip", [trip, loadItems(85), randomUUID()]);
  await who(driverA);
  await action(trip, "START");
  await visit(trip, customerA, 20);
  await who();
  expect((await report()).blockers.some((b) => b.code === "TRIP")).toBe(true);
  const first = day;
  await prepAction(trip, "CARRYOVER");
  expect((await report()).report.carryovers?.[0]?.reason).toContain(
    "Inspected",
  );
  await who(driverA);
  await rejected(
    "post_driver_delivery",
    [
      trip,
      customerA,
      "",
      "",
      JSON.stringify([
        { product_id: jar, full_jars: 1, empty_jars: 0, cartons: 0 },
      ]),
      "CREDIT",
      null,
      "",
      randomUUID(),
    ],
    /paused/,
  );
  await who();
  await close();
  const old = (await report()).report;
  await nextDay();
  await who(driverA);
  await action(trip, "CONTINUE");
  await visit(trip, customerA, 30);
  await who();
  expect((await workspace()).trips).toHaveLength(1);
  expect((await report()).report.trips[0]?.full_jars).toBe(30);
  expect((await report()).report.totals.sales).toBe("3000.00");
  expect((await report(first)).report).toEqual(old);
  const history = await rpc<{ date_label: string; full_jars: number }[]>(
    "customer_delivery_history",
    [customerA],
  );
  expect(history.map((v) => [v.date_label, v.full_jars])).toEqual(
    expect.arrayContaining([
      [date, 20],
      [tomorrow, 30],
    ]),
  );
  await who(driverB);
  await rejected("customer_delivery_history", [customerA], /Assigned customer/);
  await who();
  expect(
    (await workspace(trip)).movements.filter(
      (m) => m.movement_type === "TRIP_LOAD",
    ),
  ).toHaveLength(1);
});
it("synchronized future load is available only to its driver; offline next-day delivery confirms exactly once", async () => {
  const a = await prepare();
  await close();
  await nextDay();
  await who(driverB);
  expect((await workspace(a)).trips).toEqual([]);
  await rejected("transition_trip", [a, "START", "", randomUUID()], /access/);
  await who(driverA);
  await action(a, "START");
  const device = randomUUID(),
    token = "b".repeat(64);
  await rpc("offline_register", [a, device, token]);
  const id = randomUUID(),
    occurred = new Date().toISOString(),
    payload = JSON.stringify({
      customer: customerA,
      walk_name: "",
      walk_phone: "",
      items: [{ product_id: jar, full_jars: 50, empty_jars: 15, cartons: 0 }],
      status: "CREDIT",
      received: null,
      notes: "Offline original",
      total: "5000.00",
      prices: [{ product_id: jar, price: "100.00" }],
      custody: [{ product_id: jar, quantity: 0 }],
    });
  const args = [
    a,
    device,
    token,
    id,
    1,
    "DELIVERY",
    occurred,
    payload,
    createHash("sha256").update(payload).digest("hex"),
  ];
  expect(await rpc("offline_post", args)).toMatchObject({
    id,
    status: "CONFIRMED",
  });
  expect(await rpc("offline_post", args)).toMatchObject({
    id,
    status: "CONFIRMED",
  });
  await who();
  expect((await report()).report.totals.full_jars).toBe(50);
  expect((await workspace(a)).visits).toHaveLength(1);
  expect(
    (await workspace(a)).movements.filter(
      (m) => m.movement_type === "TRIP_LOAD",
    ),
  ).toHaveLength(1);
  await rejected(
    "trip_preparation_command",
    [a, "CARRYOVER", null, "Overnight authorized", null, randomUUID()],
    /pause checkpoint/,
  );
  expect((await report()).blockers.some((b) => b.code === "OFFLINE_SYNC")).toBe(
    true,
  );
});
it("retains ledger and finance closing safeguards even with prepared stock", async () => {
  await prepare();
  await db.exec("reset role");
  const loc = await locations();
  await db.exec("reset role");
  await db.query(
    "update public.inventory_balances set quantity=quantity+1 where location_id=$1 and product_id=$2 and stock_kind='FULL_JAR'",
    [loc.main, jar],
  );
  await who();
  expect((await report()).blockers.some((b) => b.code === "STOCK_LEDGER")).toBe(
    true,
  );
  await rejected(
    "business_day_command",
    ["REVIEW", day, JSON.stringify({ version: 1 }), randomUUID()],
    /blocked/,
  );
});
it("a registered device must confirm its complete pause manifest before carryover, then resumes the same journal and allocation", async () => {
  const date = (await report()).report.day.date_label,
    trip = await schedule(driverA, vehicleA, date),
    first = day;
  await rpc("load_trip", [trip, loadItems(85), randomUUID()]);
  await who(driverA);
  await action(trip, "START");
  const device = randomUUID(),
    token = "c".repeat(64);
  await rpc("offline_register", [trip, device, token]);
  const pauseId = randomUUID(),
    payload = JSON.stringify({ manifest: [] }),
    occurred = new Date().toISOString();
  const pause = [
    trip,
    device,
    token,
    pauseId,
    1,
    "PAUSE",
    occurred,
    payload,
    createHash("sha256").update(payload).digest("hex"),
  ];
  expect(await rpc("offline_post", pause)).toMatchObject({
    status: "CONFIRMED",
    id: pauseId,
  });
  expect(await rpc("offline_post", pause)).toMatchObject({
    status: "CONFIRMED",
    id: pauseId,
  });
  await who();
  await prepAction(trip, "CARRYOVER");
  expect((await report()).blockers).toEqual([]);
  await close();
  await nextDay();
  await who(driverA);
  await action(trip, "CONTINUE");
  const resumed = await rpc<{
    round: { phase: string; confirmed_sequence: number };
  }>("offline_read_state", [trip, device, token]);
  expect(resumed.round).toMatchObject({
    phase: "ACTIVE",
    confirmed_sequence: 1,
  });
  const delivered = JSON.stringify({
    customer: customerA,
    walk_name: "",
    walk_phone: "",
    items: [{ product_id: jar, full_jars: 20, empty_jars: 5, cartons: 0 }],
    status: "CREDIT",
    received: null,
    notes: "Continued trip",
    total: "2000.00",
    prices: [{ product_id: jar, price: "100.00" }],
    custody: [{ product_id: jar, quantity: 0 }],
  });
  const id = randomUUID(),
    args = [
      trip,
      device,
      token,
      id,
      2,
      "DELIVERY",
      new Date().toISOString(),
      delivered,
      createHash("sha256").update(delivered).digest("hex"),
    ];
  expect(await rpc("offline_post", args)).toMatchObject({
    status: "CONFIRMED",
  });
  expect(await rpc("offline_post", args)).toMatchObject({
    status: "CONFIRMED",
  });
  await who();
  expect((await report(first)).report.totals.full_jars).toBe(0);
  expect((await report()).report.totals.full_jars).toBe(20);
  expect(
    (await workspace(trip)).movements.filter(
      (m) => m.movement_type === "TRIP_LOAD",
    ),
  ).toHaveLength(1);
});
it("a pause with an incomplete device manifest remains unresolved and cannot bypass closing", async () => {
  const date = (await report()).report.day.date_label,
    trip = await schedule(driverA, vehicleA, date);
  await rpc("load_trip", [trip, loadItems(85), randomUUID()]);
  await who(driverA);
  await action(trip, "START");
  const device = randomUUID(),
    token = "d".repeat(64);
  await rpc("offline_register", [trip, device, token]);
  const payload = JSON.stringify({
    manifest: [{ id: randomUUID(), fingerprint: "a".repeat(64) }],
  });
  expect(
    await rpc("offline_post", [
      trip,
      device,
      token,
      randomUUID(),
      1,
      "PAUSE",
      new Date().toISOString(),
      payload,
      createHash("sha256").update(payload).digest("hex"),
    ]),
  ).toMatchObject({ status: "NEEDS_REVIEW" });
  await who();
  await rejected(
    "trip_preparation_command",
    [trip, "CARRYOVER", null, "Admin cannot waive queue", null, randomUUID()],
    /pause checkpoint/,
  );
  expect((await report()).blockers.some((b) => b.code === "OFFLINE_SYNC")).toBe(
    true,
  );
});
it("drivers cannot schedule, load, reschedule, unload, or authorize their own carryover", async () => {
  const a = await prepare();
  await who(driverA);
  await rejected(
    "schedule_trip",
    [randomUUID(), driverA, vehicleA, day, tomorrow, "", randomUUID()],
    /Not authorized/,
  );
  await rejected(
    "load_trip",
    [a, loadItems(1), randomUUID()],
    /Not authorized/,
  );
  for (const op of ["RESCHEDULE", "UNLOAD_CANCEL", "CARRYOVER"])
    await rejected(
      "trip_preparation_command",
      [a, op, tomorrow, "Driver unauthorized", counts(85), randomUUID()],
      /Not authorized/,
    );
});
