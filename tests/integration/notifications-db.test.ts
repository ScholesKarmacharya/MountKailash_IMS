import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { beforeAll, afterAll, beforeEach, afterEach, expect, it } from "vitest";
import type { NotificationFeed } from "@/domain/notifications";
import type { Receipt } from "@/domain/offline/types";
import { canonical } from "@/domain/offline/operations";

let db: PGlite, day: string;
const admin = randomUUID(),
  adminB = randomUUID(),
  driver = randomUUID(),
  other = randomUUID(),
  suspended = randomUUID();
const jar = randomUUID(),
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
async function denied(
  name: string,
  args: unknown[],
  match = /access|authorized|permission/i,
) {
  await db.exec("savepoint forbidden");
  await expect(rpc(name, args)).rejects.toThrow(match);
  await db.exec("rollback to savepoint forbidden");
}
const feed = () => rpc<NotificationFeed>("notification_feed", [null]);
const counts = (full = 20, empty = 0) =>
  JSON.stringify([
    { product_id: jar, stock_kind: "FULL_JAR", quantity: full },
    { product_id: jar, stock_kind: "EMPTY_JAR", quantity: empty },
  ]);
async function assigned(
  scheduled?: string,
  id = randomUUID(),
  key = randomUUID(),
) {
  if (scheduled)
    await rpc("schedule_trip", [
      id,
      driver,
      vehicle,
      day,
      scheduled,
      "Notification fixture",
      key,
    ]);
  else
    await rpc("create_trip", [
      id,
      driver,
      vehicle,
      day,
      "[]",
      "Notification fixture",
      key,
    ]);
  return id;
}
async function active() {
  const trip = await assigned();
  await rpc("load_trip", [
    trip,
    JSON.stringify([{ product_id: jar, stock_kind: "FULL_JAR", quantity: 20 }]),
    randomUUID(),
  ]);
  await who(driver);
  await rpc("transition_trip", [trip, "START", "", randomUUID()]);
  return trip;
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(
    "create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;",
  );
  for (const file of readdirSync("supabase/migrations").sort()) {
    if (file.includes("0025_notifications"))
      await db.exec(
        "create publication supabase_realtime for table public.profiles",
      );
    await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
  }
  for (const [id, name, role, approval] of [
    [admin, "Warehouse A", "ADMIN", "APPROVED"],
    [adminB, "Warehouse B", "ADMIN", "APPROVED"],
    [driver, "Driver A", "DRIVER", "APPROVED"],
    [other, "Driver B", "DRIVER", "APPROVED"],
    [suspended, "Suspended", "DRIVER", "SUSPENDED"],
  ]) {
    await db.query("insert into auth.users values($1)", [id]);
    await db.query(
      "insert into public.profiles(id,name,role,approval_status) values($1,$2,$3,$4)",
      [id, name, role, approval],
    );
  }
  await who();
  await rpc("save_product", [
    jar,
    "NOTIFY",
    "20L jar",
    "FULL_JAR",
    "jar",
    "10",
    true,
    0,
    "Fixture only",
    randomUUID(),
  ]);
  day = await rpc("open_inventory_business_day", [randomUUID()]);
  await rpc("adjust_warehouse_stock", [
    jar,
    "FULL_JAR",
    100,
    "Fixture only",
    "",
    day,
    randomUUID(),
  ]);
  await rpc("save_vehicle", [
    vehicle,
    "TEST-NOTIFY",
    "",
    true,
    0,
    "Fixture only",
    randomUUID(),
  ]);
});
afterAll(async () => {
  await db?.close();
});
beforeEach(async () => {
  await db.exec("begin");
  await who();
});
afterEach(async () => {
  await db.exec("rollback");
});

it("assigns only the approved driver, with the final scheduled date and no false loading claim", async () => {
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const trip = await assigned(tomorrow);
  expect((await feed()).items).toHaveLength(0);
  await who(other);
  expect((await feed()).items).toHaveLength(0);
  await who(driver);
  const f = await feed();
  expect(f.unread).toBe(1);
  expect(f.items[0]).toMatchObject({
    type: "TRIP_ASSIGNED",
    recipient_id: driver,
    trip_id: trip,
    payload: {
      driver: "Driver A",
      vehicle: "TEST-NOTIFY",
      scheduled_date: tomorrow,
      assigned_not_ready: true,
      counts: [],
    },
  });
  expect(
    (await db.query("select * from public.notifications")).rows,
  ).toHaveLength(1);
});
it("does not duplicate assignment or loading notifications on command retries", async () => {
  const id = randomUUID(),
    key = randomUUID();
  await assigned(undefined, id, key);
  await assigned(undefined, id, key);
  const load = JSON.stringify([
      { product_id: jar, stock_kind: "FULL_JAR", quantity: 85 },
    ]),
    loadKey = randomUUID();
  await rpc("load_trip", [id, load, loadKey]);
  await rpc("load_trip", [id, load, loadKey]);
  await who(driver);
  const f = await feed();
  expect(f.unread).toBe(2);
  expect(f.items[0]).toMatchObject({
    type: "STOCK_LOADED",
    payload: {
      counts: [{ product: "20L jar", stock_kind: "FULL_JAR", quantity: 85 }],
    },
  });
});
it("saves rescheduling and cancellation events without changing assignment rules", async () => {
  const id = await assigned();
  const future = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
  await rpc("trip_preparation_command", [
    id,
    "RESCHEDULE",
    future,
    "Customer date changed",
    null,
    randomUUID(),
  ]);
  await rpc("transition_trip", [
    id,
    "CANCEL",
    "Delivery cancelled",
    randomUUID(),
  ]);
  await who(driver);
  expect((await feed()).items.map((n) => n.type)).toEqual([
    "TRIP_CANCELLED",
    "TRIP_UPDATED",
    "TRIP_ASSIGNED",
  ]);
  expect((await feed()).items[1]!.payload.scheduled_date).toBe(future);
});
it("notifies every authorized warehouse admin after submission, and only the assigned driver after actual reconciliation", async () => {
  const trip = await active(),
    key = randomUUID();
  const before = await rpc<{ balances: unknown[] }>("operations_workspace", [
    trip,
  ]);
  await rpc("submit_trip", [trip, counts(), key]);
  await rpc("submit_trip", [trip, counts(), key]);
  expect(
    (await rpc<{ balances: unknown[] }>("operations_workspace", [trip]))
      .balances,
  ).toEqual(before.balances);
  expect((await feed()).items.some((n) => n.type === "RETURN_CONFIRMED")).toBe(
    false,
  );
  for (const id of [admin, adminB]) {
    await who(id);
    const f = await feed();
    expect(f.unread).toBe(1);
    expect(f.items[0]).toMatchObject({
      type: "RETURN_SUBMITTED",
      trip_id: trip,
      payload: {
        driver: "Driver A",
        counts: [
          { product: "20L jar", stock_kind: "EMPTY_JAR", quantity: 0 },
          { product: "20L jar", stock_kind: "FULL_JAR", quantity: 20 },
        ],
      },
    });
  }
  await who();
  const confirmKey = randomUUID();
  await rpc("reconcile_trip", [
    trip,
    counts(),
    "Physical count confirmed",
    false,
    confirmKey,
  ]);
  await rpc("reconcile_trip", [
    trip,
    counts(),
    "Physical count confirmed",
    false,
    confirmKey,
  ]);
  await who(driver);
  expect(
    (await feed()).items.filter((n) => n.type === "RETURN_CONFIRMED"),
  ).toHaveLength(1);
  await who(other);
  expect((await feed()).unread).toBe(0);
});
it("keeps a discrepancy unconfirmed and alerts warehouse reviewers", async () => {
  const trip = await active();
  await rpc("submit_trip", [trip, counts(), randomUUID()]);
  await who();
  await rpc("reconcile_trip", [
    trip,
    counts(19),
    "One jar missing",
    false,
    randomUUID(),
  ]);
  expect((await feed()).items[0]!.type).toBe("STOCK_DISCREPANCY");
  await who(driver);
  expect((await feed()).items.some((n) => n.type === "RETURN_CONFIRMED")).toBe(
    false,
  );
  expect(
    (await rpc<{ trips: { status: string }[] }>("operations_workspace", [trip]))
      .trips[0]!.status,
  ).toBe("DISCREPANCY");
});
it("rejects other recipients' acknowledgements, arbitrary inserts, and private emit calls", async () => {
  await assigned();
  await who(driver);
  const n = (await feed()).items[0]!;
  await who(other);
  await denied("notification_read", [[n.id], false, null]);
  await denied("notification_emit", [
    "fake",
    "TRIP_ASSIGNED",
    n.trip_id,
    "{}",
    true,
    true,
    null,
  ]);
  await db.exec("savepoint write_denied");
  await expect(
    db.query(
      "insert into public.notifications(recipient_id,event_key,type,entity_type,entity_id,trip_id,payload) values($1,'fake','RETURN_SUBMITTED','trip',$2,$2,'{}')",
      [admin, n.trip_id],
    ),
  ).rejects.toThrow(/permission/);
  await db.exec("rollback to savepoint write_denied");
  await who(suspended);
  await denied("notification_feed", [null]);
  await who(driver, "anon");
  await denied("notification_feed", [null]);
});
it("acknowledges one or all observed notifications without approving stock or clearing new arrivals", async () => {
  const trip = await assigned();
  await who(driver);
  const first = (await feed()).items[0]!;
  await rpc("notification_read", [[first.id], false, null]);
  expect((await feed()).unread).toBe(0);
  await who();
  await rpc("load_trip", [
    trip,
    JSON.stringify([{ product_id: jar, stock_kind: "FULL_JAR", quantity: 20 }]),
    randomUUID(),
  ]);
  await who(driver);
  await rpc("notification_read", [[], true, first.sequence]);
  expect((await feed()).unread).toBe(1);
  const last = (await feed()).items[0]!;
  await rpc("notification_read", [[], true, last.sequence]);
  expect((await feed()).unread).toBe(0);
  expect((await feed()).items).toHaveLength(2);
  expect(
    (await rpc<{ trips: { status: string }[] }>("operations_workspace", [trip]))
      .trips[0]!.status,
  ).toBe("LOADED");
});
it("rolls notification creation back with a failed operation or rolled-back transaction", async () => {
  const trip = await assigned();
  await denied(
    "load_trip",
    [
      trip,
      JSON.stringify([
        { product_id: jar, stock_kind: "FULL_JAR", quantity: 101 },
      ]),
      randomUUID(),
    ],
    /stock|negative|sufficient/i,
  );
  await who(driver);
  expect((await feed()).unread).toBe(1);
  await who();
  await db.exec("savepoint rolled_back");
  await rpc("transition_trip", [
    trip,
    "CANCEL",
    "Temporary fixture",
    randomUUID(),
  ]);
  await db.exec("rollback to savepoint rolled_back");
  await who(driver);
  expect((await feed()).items.map((n) => n.type)).toEqual(["TRIP_ASSIGNED"]);
});
it("emits an offline return only after server confirmation, including retry recovery", async () => {
  const trip = await active();
  await rpc("offline_register", [trip, device, token]);
  await who();
  expect((await feed()).unread).toBe(0);
  await who(driver);
  const payload = canonical({ counts: JSON.parse(counts()), manifest: [] }),
    id = randomUUID();
  const args = [
    trip,
    device,
    token,
    id,
    1,
    "SUBMIT",
    new Date().toISOString(),
    payload,
    createHash("sha256").update(payload).digest("hex"),
  ];
  expect((await rpc<Receipt>("offline_post", args)).status).toBe("CONFIRMED");
  await rpc("offline_post", args);
  await who();
  expect((await feed()).items.map((n) => n.type)).toEqual(["RETURN_SUBMITTED"]);
});
it("persists review alerts for failed offline submissions with no premature return event", async () => {
  const trip = await active();
  await rpc("offline_register", [trip, device, token]);
  const payload = canonical({ counts: [], manifest: [] }),
    id = randomUUID();
  const args = [
    trip,
    device,
    token,
    id,
    1,
    "SUBMIT",
    new Date().toISOString(),
    payload,
    createHash("sha256").update(payload).digest("hex"),
  ];
  expect((await rpc<Receipt>("offline_post", args)).status).toBe(
    "NEEDS_REVIEW",
  );
  await rpc("offline_post", args);
  await who();
  expect((await feed()).items.map((n) => n.type)).toEqual([
    "TRANSACTION_REVIEW",
  ]);
  await who(driver);
  expect((await feed()).items[0]!.type).toBe("TRANSACTION_REVIEW");
});
it("deduplicates recorded idempotency conflicts without reposting an operation", async () => {
  const trip = await active();
  await rpc("offline_register", [trip, device, token]);
  const payload = canonical({ counts: [], manifest: [] }),
    id = randomUUID();
  const args = [
    trip,
    device,
    token,
    id,
    1,
    "SUBMIT",
    new Date().toISOString(),
    payload,
    createHash("sha256").update(payload).digest("hex"),
  ];
  await rpc("offline_post", args);
  const modified = canonical({ counts: JSON.parse(counts()), manifest: [] });
  const conflict = [
    ...args.slice(0, 7),
    modified,
    createHash("sha256").update(modified).digest("hex"),
  ];
  await rpc("offline_post", conflict);
  await rpc("offline_post", conflict);
  await who();
  const f = await feed();
  expect(f.items.filter((n) => n.type === "SYNC_REVIEW")).toHaveLength(1);
  expect(f.items.some((n) => n.type === "RETURN_SUBMITTED")).toBe(false);
});
it("paginates history newest first with an exact unread count across pages", async () => {
  const trip = await assigned();
  await db.exec("reset role");
  await db.query(
    "insert into public.notifications(recipient_id,event_key,type,entity_type,entity_id,trip_id,payload) select $1,'test:'||s,'TRIP_UPDATED','trip',$2,$2,public.notification_trip_payload($2) from generate_series(1,65) s",
    [driver, trip],
  );
  await who(driver);
  const first = await feed();
  expect(first.items).toHaveLength(50);
  expect(first.unread).toBe(66);
  const second = await rpc<NotificationFeed>("notification_feed", [
    first.items.at(-1)!.sequence,
  ]);
  expect(second.items).toHaveLength(16);
  expect(second.unread).toBe(66);
  expect(new Set([...first.items, ...second.items].map((n) => n.id)).size).toBe(
    66,
  );
});
it("supports PostgREST read-only feed transactions and preserves the Realtime publication", async () => {
  await db.exec("set transaction read only");
  expect((await feed()).unread).toBe(0);
  const tables = (
    await db.query<{ tablename: string }>(
      "select tablename from pg_publication_tables where pubname='supabase_realtime' order by tablename",
    )
  ).rows.map((r) => r.tablename);
  expect(tables).toEqual(["notifications", "profiles"]);
});
it("does not let a foreign operation UUID replay generate alerts for another driver's trip", async () => {
  const trip = await active();
  await rpc("offline_register", [trip, device, token]);
  const payload = canonical({ counts: [], manifest: [] }),
    id = randomUUID(),
    at = new Date().toISOString();
  const hash = createHash("sha256").update(payload).digest("hex");
  await rpc("offline_post", [
    trip,
    device,
    token,
    id,
    1,
    "SUBMIT",
    at,
    payload,
    hash,
  ]);
  await who();
  const secondVehicle = randomUUID(),
    secondTrip = randomUUID(),
    secondDevice = randomUUID();
  await rpc("save_vehicle", [
    secondVehicle,
    "FOREIGN-REPLAY",
    "",
    true,
    0,
    "Isolated security fixture",
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
    JSON.stringify([{ product_id: jar, stock_kind: "FULL_JAR", quantity: 20 }]),
    randomUUID(),
  ]);
  await who(other);
  await rpc("transition_trip", [secondTrip, "START", "", randomUUID()]);
  await rpc("offline_register", [secondTrip, secondDevice, token]);
  await rpc("offline_post", [
    secondTrip,
    secondDevice,
    token,
    id,
    1,
    "SUBMIT",
    at,
    payload,
    hash,
  ]);
  expect(
    (await feed()).items.some((n) => n.entity_type === "offline_operation"),
  ).toBe(false);
  await who();
  const alerts = (await feed()).items;
  expect(alerts.map((n) => n.type)).toEqual(["TRANSACTION_REVIEW"]);
  expect(alerts[0]!.trip_id).toBe(trip);
});
