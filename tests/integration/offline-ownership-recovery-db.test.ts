import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, beforeEach, afterEach, it, expect } from "vitest";
import type { DriverOfflineAccess } from "@/domain/offline/admin";
import { currentRound } from "@/domain/operations/driver-workspace";
import type { Workspace } from "@/domain/operations/types";

const admin = randomUUID(),
  driver = randomUUID(),
  other = randomUUID(),
  trip = randomUUID(),
  vehicle = randomUUID(),
  jar = randomUUID(),
  old = randomUUID(),
  token = "a".repeat(64);
const migration = "202610170032_offline_ownership_recovery.sql";
let db: PGlite;
let before: DriverOfflineAccess;
async function actor(id = admin) {
  await db.exec("reset role;set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
}
async function call<T = string>(name: string, args: unknown[] = []) {
  return (
    await db.query<{ v: T }>(
      `select public.${name}(${args.map((_, i) => `$${i + 1}`).join(",")}) v`,
      args,
    )
  ).rows[0]!.v;
}
async function denied(name: string, args: unknown[], code?: string) {
  await db.exec("savepoint denied");
  if (code) await expect(call(name, args)).rejects.toMatchObject({ code });
  else await expect(call(name, args)).rejects.toThrow();
  await db.exec("rollback to savepoint denied");
}
const status = () =>
  call<DriverOfflineAccess>("admin_driver_offline_access", [driver]);
beforeAll(async () => {
  db = new PGlite();
  await db.exec(
    "create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,email text);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;",
  );
  for (const f of readdirSync("supabase/migrations")
    .sort()
    .filter((f) => f !== migration))
    await db.exec(readFileSync(`supabase/migrations/${f}`, "utf8"));
  for (const id of [admin, driver, other])
    await db.query("insert into auth.users(id,email) values($1,$2)", [
      id,
      `${id}@test.example`,
    ]);
  await db.query(
    "insert into public.profiles(id,name,role,approval_status) values($1,'Admin','ADMIN','APPROVED'),($2,'Driver','DRIVER','APPROVED'),($3,'Other','DRIVER','APPROVED')",
    [admin, driver, other],
  );
  await actor();
  await call("save_product", [
    jar,
    "RECOVERY",
    "Jar",
    "FULL_JAR",
    "jar",
    "10.00",
    true,
    0,
    "Isolated test",
    randomUUID(),
  ]);
  const day = await call("open_inventory_business_day", [randomUUID()]);
  await call("adjust_warehouse_stock", [
    jar,
    "FULL_JAR",
    100,
    "Isolated test",
    "",
    day,
    randomUUID(),
  ]);
  await call("save_vehicle", [
    vehicle,
    "RECOVERY",
    "",
    true,
    0,
    "Isolated test",
    randomUUID(),
  ]);
  await call("create_trip", [trip, driver, vehicle, day, [], "", randomUUID()]);
  await call("load_trip", [
    trip,
    [{ product_id: jar, stock_kind: "FULL_JAR", quantity: 10 }],
    randomUUID(),
  ]);
  await actor(driver);
  await call("trusted_device_register", [
    old,
    token,
    "Old browser",
    "automatic-key-stored-only-on-device",
  ]);
  await actor();
  await call("trusted_device_revoke", [old, "Already revoked browser"]);
  before = await status();
  await actor(driver);
  await expect(
    call("offline_preparation_access", [trip, old, token]),
  ).rejects.toMatchObject({ code: "MK001" });
  await db.exec("reset role");
  await db.exec(readFileSync(`supabase/migrations/${migration}`, "utf8"));
}, 30000);
afterAll(async () => db.close());
beforeEach(async () => {
  await db.exec("reset role;begin");
  await actor();
});
afterEach(async () => {
  await db.exec("rollback;reset role");
});

it("reproduces the actual pre-fix UAT contradiction and makes revoked-without-round access resettable", async () => {
  expect(before).toMatchObject({
    trip_id: trip,
    status: "No device registered",
    can_reset: false,
    device_registered: false,
    reset_pending: false,
  });
  expect(await status()).toMatchObject({
    trip_id: trip,
    status: "Device reset required",
    can_reset: true,
    device_registered: false,
    reset_pending: false,
  });
  expect(
    (
      await db.query(
        "select trip_id from public.driver_offline_rounds where trip_id=$1",
        [trip],
      )
    ).rows,
  ).toHaveLength(0);
  await actor(driver);
  await denied("offline_preparation_access", [trip, old, token], "MK002");
  await actor();
  const key = randomUUID();
  await call("offline_admin_reset_access", [
    driver,
    trip,
    "Recover revoked browser",
    key,
  ]);
  const waiting = await status();
  expect(waiting).toMatchObject({
    status: "Waiting for driver device",
    trip_id: trip,
    device_registered: false,
    previous_device_revoked: true,
    reset_pending: true,
    can_reset: true,
    last_reset_at: expect.any(String),
    last_reset_by: admin,
  });
  await call("offline_admin_reset_access", [
    driver,
    trip,
    "Repeat pending reset",
    randomUUID(),
  ]);
  expect((await status()).last_reset_at).toBe(waiting.last_reset_at);
  await actor(driver);
  expect(await call("offline_preparation_access", [trip, old, token])).toEqual({
    allowed: false,
    replace_installation: true,
  });
  await denied("trusted_device_register", [
    old,
    token,
    "Old browser",
    "automatic-key-stored-only-on-device",
  ]);
  const next = randomUUID(),
    nextToken = "b".repeat(64);
  await call("trusted_device_register", [
    next,
    nextToken,
    "Replacement",
    "automatic-key-stored-only-on-device",
  ]);
  await actor();
  await call("offline_admin_reset_access", [
    driver,
    trip,
    "Repeat while replacement prepares",
    randomUUID(),
  ]);
  expect(await status()).toMatchObject({
    status: "Waiting for driver device",
    device_registered: true,
  });
  await actor(driver);
  await call("offline_register", [trip, next, nextToken]);
  await denied("offline_checkin", [trip, old, token, 0]);
  await denied("offline_preparation_access", [trip, old, token]);
  await actor();
  expect(await status()).toMatchObject({
    status: "Offline access active",
    reset_pending: false,
    device_registered: true,
  });
  // A lost reset response cannot revoke the replacement.
  await call("offline_admin_reset_access", [
    driver,
    trip,
    "Recover revoked browser",
    key,
  ]);
  expect((await status()).device_registered).toBe(true);
});

it.each([false, true])(
  "preserves a LOADED round with trusted row revoked=%s and transfers only after an audited admin reset",
  async (revoke) => {
    const a = randomUUID(),
      b = randomUUID(),
      bToken = "c".repeat(64);
    await actor(driver);
    await call("trusted_device_register", [
      a,
      token,
      "Owner A",
      "automatic-key-stored-only-on-device",
    ]);
    await call("offline_register", [trip, a, token]);
    await actor();
    if (revoke)
      await call("trusted_device_revoke", [a, "Revoked before reset"]);
    await db.exec("reset role");
    const round = (
      await db.query(
        "select * from public.driver_offline_rounds where trip_id=$1",
        [trip],
      )
    ).rows[0]!;
    await actor();
    expect((await status()).can_reset).toBe(true);
    await call("offline_admin_reset_access", [
      driver,
      trip,
      "Replace owner A",
      randomUUID(),
    ]);
    await db.exec("reset role");
    const resetRound = (
      await db.query(
        "select * from public.driver_offline_rounds where trip_id=$1",
        [trip],
      )
    ).rows[0]!;
    await actor();
    expect(resetRound).toMatchObject({
      ...round,
      offline_device_reset_pending: true,
      offline_device_reset_at: expect.any(Date),
      offline_device_reset_by: admin,
      offline_device_reset_reason: "Replace owner A",
      offline_device_reset_id: expect.any(String),
    });
    expect(await status()).toMatchObject({
      status: "Waiting for driver device",
      trip_id: trip,
      previous_device_revoked: true,
      can_reset: true,
    });
    await actor(driver);
    await denied("offline_checkin", [trip, a, token, 0]);
    expect(await call("offline_preparation_access", [trip, b, bToken])).toEqual(
      { allowed: true },
    );
    await call("trusted_device_register", [
      b,
      bToken,
      "Owner B",
      "automatic-key-stored-only-on-device",
    ]);
    await call("offline_register", [trip, b, bToken]);
    await denied("offline_checkin", [trip, a, token, 0]);
    expect(await call("offline_checkin", [trip, b, bToken, 0])).toBeDefined();
    await actor();
    expect(
      (
        await db.query(
          "select device_id,phase from public.driver_offline_rounds where trip_id=$1",
          [trip],
        )
      ).rows[0],
    ).toEqual({ device_id: b, phase: "PREPARED" });
    const reviews = (
      await db.query<{ action: string }>(
        "select action from public.driver_offline_reviews where trip_id=$1 order by created_at,action",
        [trip],
      )
    ).rows.map((r) => r.action);
    expect(reviews).toEqual(["DEVICE_RESET", "DEVICE_TRANSFER"]);
  },
);

it("uses the same trip selection as the driver and denies private metadata helpers and other-driver diagnostics", async () => {
  const workspace = await call<Workspace>("operations_workspace", [null]);
  expect((await status()).trip_id).toBe(
    currentRound({
      ...workspace,
      trips: workspace.trips.filter((t) => t.driver_id === driver),
    })?.id,
  );
  await actor(other);
  await denied("offline_ownership_diagnostics", [driver, old], "42501");
  await actor(driver);
  await denied("offline_driver_access_state", [driver], "42501");
  await denied("offline_current_trip", [driver], "42501");
  await denied(
    "offline_preparation_access_before_recovery",
    [trip, old, token],
    "42501",
  );
  const diagnostic = await call<Record<string, unknown>>(
    "offline_ownership_diagnostics",
    [driver, old],
  );
  expect(diagnostic).toMatchObject({
    driver_id: driver,
    current_trip_id: trip,
    round_device_id: null,
    trusted_device_exists: true,
    trusted_device_revoked: true,
    incoming_device_id: old,
    reset_eligible: true,
  });
  expect(JSON.stringify(diagnostic)).not.toMatch(
    /token|hash|secret|recovery|password/,
  );
});
it("supports diagnostic reads in PostgREST read-only transactions", async () => {
  await db.exec("rollback;begin read only");
  await actor(driver);
  expect(
    await call("offline_ownership_diagnostics", [driver, old]),
  ).toMatchObject({ driver_id: driver, current_trip_id: trip });
});
it("can replace a paused current trip's device without unpausing it or authorizing the old writer", async () => {
  const a = randomUUID(),
    b = randomUUID();
  await actor(driver);
  await call("trusted_device_register", [
    a,
    token,
    "Paused owner",
    "automatic-key-stored-only-on-device",
  ]);
  await call("offline_register", [trip, a, token]);
  await db.exec("reset role");
  await db.query(
    "update public.driver_offline_rounds set phase='PAUSED' where trip_id=$1",
    [trip],
  );
  await actor();
  await call("offline_admin_reset_access", [
    driver,
    trip,
    "Replace paused owner",
    randomUUID(),
  ]);
  await actor(driver);
  await call("trusted_device_register", [
    b,
    "b".repeat(64),
    "Replacement",
    "automatic-key-stored-only-on-device",
  ]);
  expect(
    await call("offline_register", [trip, b, "b".repeat(64)]),
  ).toMatchObject({ phase: "PAUSED", device_id: b });
  await denied("offline_checkin", [trip, a, token, 0]);
});
