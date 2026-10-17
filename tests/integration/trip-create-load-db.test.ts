import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, beforeEach, afterEach, it, expect } from "vitest";
import type { Count, Workspace } from "@/domain/operations/types";

let db: PGlite, day: string, date: string;
const admin = randomUUID(),
  driver = randomUUID(),
  other = randomUUID(),
  jar = randomUUID(),
  carton = randomUUID(),
  vehicle = randomUUID(),
  secondVehicle = randomUUID();
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
async function scalar(sql: string, args: unknown[] = []) {
  return Object.values((await db.query(sql, args)).rows[0]!)[0];
}
const items = (full = 30, cartons = 5): Count[] => [
  { product_id: jar, stock_kind: "FULL_JAR", quantity: full },
  { product_id: carton, stock_kind: "BOTTLE_CARTON", quantity: cartons },
];
function args(
  confirm = true,
  lines: unknown = items(),
  id = randomUUID(),
  key = randomUUID(),
  driverId = driver,
  vehicleId = vehicle,
  scheduled = date,
) {
  return [
    id,
    driverId,
    vehicleId,
    day,
    scheduled,
    "Optional warehouse note",
    JSON.stringify(lines),
    confirm,
    key,
  ];
}
async function rejected(values: unknown[], match: RegExp) {
  await db.exec("savepoint rejected");
  await expect(rpc("create_trip_with_load", values)).rejects.toThrow(match);
  await db.exec("rollback to savepoint rejected");
}
const workspace = (trip: string | null = null) =>
  rpc<Workspace>("operations_workspace", [trip]);
async function ledgerState() {
  await db.exec("reset role");
  const state = {
    balances: (
      await db.query(
        "select location_id,product_id,stock_kind,quantity,version from public.inventory_balances order by location_id,product_id,stock_kind",
      )
    ).rows,
    trips: await scalar("select count(*) from public.trips"),
    loads: await scalar("select count(*) from public.trip_load_items"),
    movements: await scalar("select count(*) from public.stock_movements"),
    requests: await scalar("select count(*) from public.operation_requests"),
    audit: await scalar("select count(*) from public.audit_events"),
    notifications: await scalar("select count(*) from public.notifications"),
  };
  await who();
  return state;
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;`);
  for (const file of readdirSync("supabase/migrations").sort())
    await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
  for (const [id, role] of [
    [admin, "ADMIN"],
    [driver, "DRIVER"],
    [other, "DRIVER"],
  ]) {
    await db.query("insert into auth.users values($1)", [id]);
    await db.query(
      "insert into public.profiles(id,name,role,approval_status) values($1,'Trip test actor',$2,'APPROVED')",
      [id, role],
    );
  }
}, 30000);
afterAll(async () => {
  await db?.close();
});
beforeEach(async () => {
  await db.exec("begin");
  await who();
  day = await rpc("open_inventory_business_day", [randomUUID()]);
  date = (await workspace()).days.find((d) => d.id === day)!.date_label;
  for (const [id, name, kind, stock] of [
    [jar, "Water jar", "FULL_JAR", 100],
    [carton, "Water carton", "BOTTLE_CARTON", 20],
  ] as const) {
    await rpc("save_product", [
      id,
      name.replaceAll(" ", "-").toUpperCase(),
      name,
      kind,
      "unit",
      "100",
      true,
      0,
      "Isolated trip test",
      randomUUID(),
    ]);
    await rpc("adjust_warehouse_stock", [
      id,
      kind,
      stock,
      "Isolated trip stock",
      "",
      day,
      randomUUID(),
    ]);
  }
  for (const [id, plate] of [
    [vehicle, "LOAD-A"],
    [secondVehicle, "LOAD-B"],
  ])
    await rpc("save_vehicle", [
      id,
      plate,
      "",
      true,
      0,
      "Isolated trip test",
      randomUUID(),
    ]);
});
afterEach(async () => {
  await db.exec("rollback");
});

it("saves proposed draft quantities and edits them without stock, load evidence or physical confirmation", async () => {
  const before = await ledgerState();
  const request = args(false);
  const trip = await rpc("create_trip_with_load", request);
  let w = await workspace(trip);
  expect(w.trips[0]).toMatchObject({
    status: "DRAFT",
    proposed_load_items: items(),
    loaded_at: null,
    notes: "Optional warehouse note",
  });
  expect(w.loads).toEqual([]);
  expect((await ledgerState()).balances).toEqual(before.balances);
  expect((await ledgerState()).movements).toBe(before.movements);
  await rpc("save_trip_draft_load", [
    trip,
    JSON.stringify(items(45, 7)),
    randomUUID(),
  ]);
  await rpc("trip_preparation_command", [
    trip,
    "RESCHEDULE",
    date,
    "Preserved draft editing",
    null,
    randomUUID(),
  ]);
  w = await workspace(trip);
  expect(w.trips[0]?.proposed_load_items).toEqual(items(45, 7));
  expect(w.trips[0]?.status).toBe("DRAFT");
  await who(driver);
  await db.exec("savepoint cannot_start");
  await expect(
    rpc("transition_trip", [trip, "START", "", randomUUID()]),
  ).rejects.toThrow(/ready|current state|loaded/i);
  await db.exec("rollback to savepoint cannot_start");
  await who();
  await rpc("load_trip", [trip, JSON.stringify(items(45, 7)), randomUUID()]);
  w = await workspace(trip);
  expect(w.trips[0]).toMatchObject({
    status: "LOADED",
    loaded_by: admin,
    loading_business_day_id: day,
  });
  expect(
    w.loads.map(({ product_id, stock_kind, quantity }) => ({
      product_id,
      stock_kind,
      quantity,
    })),
  ).toEqual(expect.arrayContaining(items(45, 7)));
});

it("creates and confirms every product through the existing load journal, ready for the assigned driver to start", async () => {
  const trip = await rpc("create_trip_with_load", args());
  const w = await workspace(trip);
  const t = w.trips[0]!;
  expect(t).toMatchObject({
    status: "LOADED",
    loaded_by: admin,
    loading_business_day_id: day,
    scheduled_date: date,
  });
  expect(t.loaded_at).toBeTruthy();
  expect(w.loads).toHaveLength(2);
  expect(
    w.movements.filter((m) => m.movement_type === "TRIP_LOAD"),
  ).toHaveLength(2);
  const warehouse = w.locations.find((l) => l.code === "MAIN")!.id;
  expect(
    w.balances.find(
      (b) =>
        b.location_id === warehouse &&
        b.product_id === jar &&
        b.stock_kind === "FULL_JAR",
    )?.quantity,
  ).toBe(70);
  expect(
    w.balances.find(
      (b) => b.location_id === warehouse && b.product_id === carton,
    )?.quantity,
  ).toBe(15);
  expect(
    await scalar(
      "select count(*) from public.audit_events where entity_id=$1 and action='TRIP_LOADED'",
      [trip],
    ),
  ).toBe(1);
  await who(driver);
  expect(
    await scalar(
      "select count(*) from public.notifications where trip_id=$1 and type='STOCK_LOADED'",
      [trip],
    ),
  ).toBe(1);
  await who(driver);
  expect((await workspace(trip)).trips[0]?.status).toBe("LOADED");
  await rpc("transition_trip", [trip, "START", "", randomUUID()]);
  expect((await workspace(trip)).trips[0]?.status).toBe("ACTIVE");
  expect(
    (await workspace(trip)).movements.filter(
      (m) => m.movement_type === "TRIP_LOAD",
    ),
  ).toHaveLength(2);
});

it("rejects stale stock and all invalid quantities without leaving reservations, partial loads or journals", async () => {
  await rpc("adjust_warehouse_stock", [
    jar,
    "FULL_JAR",
    -28,
    "Stock changed while form open",
    "",
    day,
    randomUUID(),
  ]);
  const before = await ledgerState();
  await rejected(
    args(true, items(80, 5)),
    /Requested 80 Water jar, but only 72/,
  );
  for (const invalid of [
    [],
    items(0, 0),
    items(-1, 5),
    items(0.5, 5),
    [{ ...items()[0], quantity: "2" }],
    [{ ...items()[0], stock_kind: "EMPTY_JAR" }],
    [items()[0], items()[0]],
    [{ ...items()[0], product_id: randomUUID() }],
  ]) {
    await rejected(args(true, invalid), /product|quantit|items/i);
    expect(await ledgerState()).toEqual(before);
  }
  await rejected(args(false, items(80, 0)), /only 72/);
  expect(await ledgerState()).toEqual(before);
});

it("rolls back creation, all product moves, audit, notifications and request keys if the later load writer fails", async () => {
  // Fail after a genuine stock movement has happened, not just in prevalidation.
  await db.exec("reset role");
  await db.exec(`create function public.test_reject_load() returns trigger language plpgsql as $$begin raise exception using errcode='22023',message='Simulated physical load failure';end$$;
    create trigger test_reject_load before insert on public.trip_load_items for each row execute function public.test_reject_load();`);
  await who();
  const before = await ledgerState();
  await rejected(args(), /Simulated physical load failure/);
  expect(await ledgerState()).toEqual(before);
  await db.exec(
    "reset role;drop trigger test_reject_load on public.trip_load_items;drop function public.test_reject_load()",
  );
  await who();
  // Failed reservations were rolled back, so the same driver/vehicle can retry.
  await rpc("create_trip_with_load", args());
});

it("retains the unique driver and vehicle reservation rules with clear errors", async () => {
  await rpc("create_trip_with_load", args(false));
  const before = await ledgerState();
  await rejected(
    args(true, items(), randomUUID(), randomUUID(), driver, secondVehicle),
    /driver is already reserved/,
  );
  await rejected(
    args(true, items(), randomUUID(), randomUUID(), other, vehicle),
    /vehicle is already assigned/,
  );
  expect(await ledgerState()).toEqual(before);
});

it("replays an acknowledged or lost-response request exactly once and rejects a changed payload", async () => {
  const request = args();
  const id = await rpc("create_trip_with_load", request);
  const before = await ledgerState();
  expect(await rpc("create_trip_with_load", request)).toBe(id);
  expect(await rpc("create_trip_with_load", request)).toBe(id);
  expect(await ledgerState()).toEqual(before);
  const changed = [...request];
  changed[6] = JSON.stringify(items(31, 5));
  await rejected(changed, /Idempotency key/);
  expect(await ledgerState()).toEqual(before);
});

it("keeps existing loaded and closed history unchanged and supports empty drafts and future loads", async () => {
  const historical = await rpc("create_trip_with_load", args(false, []));
  await rpc("transition_trip", [
    historical,
    "CANCEL",
    "Unused historical draft",
    randomUUID(),
  ]);
  const closedBefore = await scalar(
    "select to_jsonb(t) from public.trips t where id=$1",
    [historical],
  );
  const future = new Date(Date.parse(date) + 86400000)
    .toISOString()
    .slice(0, 10);
  const trip = await rpc(
    "create_trip_with_load",
    args(true, items(), randomUUID(), randomUUID(), driver, vehicle, future),
  );
  expect((await workspace(trip)).trips[0]).toMatchObject({
    status: "LOADED",
    scheduled_date: future,
  });
  expect(
    await scalar("select to_jsonb(t) from public.trips t where id=$1", [
      historical,
    ]),
  ).toEqual(closedBefore);
});

it("enforces admin permission and open-day/date validation on the database boundary", async () => {
  await who(driver);
  await rejected(args(), /authorized/);
  await who();
  const before = await ledgerState();
  await rejected(
    args(
      true,
      items(),
      randomUUID(),
      randomUUID(),
      driver,
      vehicle,
      "2000-01-01",
    ),
    /future date/,
  );
  const closedDay = args();
  closedDay[3] = randomUUID();
  await rejected(closedDay, /OPEN business day/);
  expect(await ledgerState()).toEqual(before);
});
