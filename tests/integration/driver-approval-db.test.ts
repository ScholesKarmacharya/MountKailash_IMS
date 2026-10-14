import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID, createHash } from "node:crypto";
import { beforeAll, afterAll, beforeEach, afterEach, it, expect } from "vitest";
const admin = randomUUID(),
  driver = randomUUID(),
  inactive = randomUUID(),
  pending = randomUUID(),
  direct = randomUUID();
const jar = randomUUID(),
  customer = randomUUID(),
  vehicle = randomUUID(),
  trip = randomUUID();
let db: PGlite, day: string, legacyBefore: string;
async function actor(id: string | null, role = "authenticated") {
  await db.exec(`reset role;set role ${role}`);
  await db.query<Record<string, unknown>>(
    "select set_config('request.jwt.claim.sub',$1,false)",
    [id ?? ""],
  );
}
async function call<T = string>(name: string, args: unknown[] = []) {
  return (
    await db.query<{ value: T }>(
      `select public.${name}(${args.map((_, i) => `$${i + 1}`).join(",")}) as value`,
      args,
    )
  ).rows[0]!.value;
}
async function denied(
  name: string,
  args: unknown[],
  message = /authorized|access|Active admin|permission denied/,
) {
  await db.exec("savepoint denied");
  await expect(call(name, args)).rejects.toThrow(message);
  await db.exec("rollback to savepoint denied");
}
async function history() {
  // Snapshot actual historical inventory/sales/payments/custody, not only counts.
  const tables = [
    "auth.users",
    "public.stock_movements",
    "public.inventory_balances",
    "public.trips",
    "public.trip_visits",
    "public.visit_items",
    "public.sales",
    "public.invoices",
    "public.payments",
    "public.customer_ledger",
    "public.jar_custody_entries",
    "public.jar_custody_balances",
    "public.business_days",
  ];
  const rows = [];
  for (const table of tables)
    rows.push(
      (
        await db.query<Record<string, unknown>>(
          // Compare all original fields across forward migrations. New optional
          // offline metadata is checked separately; old records stay unchanged.
          `select coalesce(jsonb_agg(to_jsonb(t)-array['offline_occurred_at','supply_classification','reference_price_snapshot','free_value_snapshot','scheduled_date','created_business_day_id','loaded_at','loaded_by','loading_business_day_id','cancelled'] order by (to_jsonb(t)-array['offline_occurred_at','supply_classification','reference_price_snapshot','free_value_snapshot','scheduled_date','created_business_day_id','loaded_at','loaded_by','loading_business_day_id','cancelled'])::text),'[]'::jsonb) as v from ${table} t`,
        )
      ).rows[0]!.v,
    );
  return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,email text);
  create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
  grant usage on schema auth to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;`);
  const files = readdirSync("supabase/migrations").sort();
  for (const file of files.filter((f) => f < "202610120016"))
    await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
  for (const [id, email] of [
    [admin, "admin@test.example"],
    [driver, "existing@test.example"],
    [inactive, "inactive@test.example"],
    [pending, "pending@test.example"],
    [direct, "direct@test.example"],
  ])
    await db.query<Record<string, unknown>>(
      "insert into auth.users(id,email) values($1,$2)",
      [id, email],
    );
  await db.query<Record<string, unknown>>(
    "insert into public.profiles(id,name,role,is_active) values($1,'Actual Admin','ADMIN',true),($2,'Existing Driver','DRIVER',true),($3,'Inactive Driver','DRIVER',false)",
    [admin, driver, inactive],
  );
  await actor(admin);
  await call("save_product", [
    jar,
    "JAR",
    "Approval test jar",
    "FULL_JAR",
    "jar",
    "150.25",
    true,
    0,
    "Ephemeral approval fixture",
    randomUUID(),
  ]);
  day = await call("open_inventory_business_day", [randomUUID()]);
  await call("adjust_warehouse_stock", [
    jar,
    "FULL_JAR",
    12,
    "Ephemeral approval fixture",
    "",
    day,
    randomUUID(),
  ]);
  await call("save_customer", [
    customer,
    "Historical Customer",
    "",
    "",
    "",
    "",
    true,
    0,
    "Ephemeral approval fixture",
    randomUUID(),
  ]);
  await call("save_vehicle", [
    vehicle,
    "APPROVAL-TEST",
    "",
    true,
    0,
    "Ephemeral approval fixture",
    randomUUID(),
  ]);
  await call("create_trip", [
    trip,
    driver,
    vehicle,
    day,
    "[]",
    "",
    randomUUID(),
  ]);
  await call("load_trip", [
    trip,
    JSON.stringify([{ product_id: jar, stock_kind: "FULL_JAR", quantity: 10 }]),
    randomUUID(),
  ]);
  await actor(driver);
  await call("transition_trip", [trip, "START", "", randomUUID()]);
  await call("post_driver_delivery", [
    trip,
    customer,
    "",
    "",
    JSON.stringify([
      { product_id: jar, full_jars: 2, empty_jars: 1, cartons: 0 },
    ]),
    "PAID",
    "300.50",
    "",
    randomUUID(),
  ]);
  await db.exec("reset role");
  legacyBefore = await history();
  for (const file of files.filter((f) => f >= "202610120016"))
    await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
  const metadata = (
    await db.query<Record<string, unknown>>(
      "select scheduled_date::text,created_business_day_id,loaded_at,cancelled from public.trips where id=$1",
      [trip],
    )
  ).rows[0]!;
  expect(metadata.created_business_day_id).toBe(day);
  expect(metadata.scheduled_date).toBe(
    (
      await db.query<Record<string, unknown>>(
        "select date_label::text from public.business_days where id=$1",
        [day],
      )
    ).rows[0]!.date_label,
  );
  expect(metadata.loaded_at).toBeNull(); // No invented historical loading stamp.
  expect(metadata.cancelled).toBe(false);
}, 30000);
afterAll(async () => db.close());
beforeEach(async () => {
  await db.exec("begin");
  await actor(admin);
});
afterEach(async () => {
  await db.exec("rollback;reset role");
});
it("backfills only previously trusted active drivers and preserves real business history and Auth IDs", async () => {
  const rows = await db.query<Record<string, unknown>>(
    "select id,approval_status,is_active,approved_at,approved_by from public.profiles where role='DRIVER' order by id",
  );
  expect(rows.rows.find((p) => p.id === driver)).toMatchObject({
    approval_status: "APPROVED",
    is_active: true,
    approved_at: null,
    approved_by: null,
  });
  expect(rows.rows.find((p) => p.id === inactive)).toMatchObject({
    approval_status: "SUSPENDED",
    is_active: false,
  });
  await db.exec("reset role");
  expect(await history()).toBe(legacyBefore);
  expect(
    (
      await db.query<{ n: number }>(
        "select count(*)::int n from public.trip_visits where offline_occurred_at is not null",
      )
    ).rows[0]!.n,
  ).toBe(0);
});
it("registers only the authenticated identity as pending and blocks business RLS and operational RPCs", async () => {
  await actor(pending);
  const key = randomUUID();
  expect(
    await call("save_own_profile", ["Ram Thapa", "9800000000", 0, key]),
  ).toBe(pending);
  expect(
    await call("save_own_profile", ["Ram Thapa", "9800000000", 0, key]),
  ).toBe(pending);
  expect(
    (
      await db.query<Record<string, unknown>>(
        "select id,name,role,is_active,approval_status,phone from public.profiles",
      )
    ).rows,
  ).toEqual([
    {
      id: pending,
      name: "Ram Thapa",
      role: "DRIVER",
      is_active: false,
      approval_status: "PENDING",
      phone: "9800000000",
    },
  ]);
  expect(await call<boolean>("has_operational_access")).toBe(false);
  for (const table of [
    "customers",
    "products",
    "vehicles",
    "inventory_balances",
    "trips",
    "trip_visits",
    "sales",
    "payments",
    "customer_ledger",
    "jar_custody_balances",
    "stock_movements",
    "audit_events",
    "billing_company",
  ])
    expect(
      (await db.query<Record<string, unknown>>(`select * from public.${table}`))
        .rows,
    ).toEqual([]);
  for (const [name, args] of [
    ["delivery_customer_directory", []],
    ["pending_jar_directory", [null]],
    ["finance_workspace", []],
    ["submit_trip", [trip, "[]", randomUUID()]],
    [
      "post_driver_delivery",
      [trip, customer, "", "", "[]", "CREDIT", null, "", randomUUID()],
    ],
    [
      "save_delivery_customer",
      [trip, randomUUID(), "Forbidden", "", "", "", 0, false, randomUUID()],
    ],
  ] as [string, unknown[]][])
    await denied(name, args, /authorized|Active account|access/);
});
it("defaults new admin-provisioned profiles to pending; explicit creation approval records the admin", async () => {
  await call("save_driver_account", [
    pending,
    "New Driver",
    "",
    0,
    false,
    "Review new account",
    randomUUID(),
  ]);
  expect(
    (
      await call<[{ approval_status: string; email: string }]>(
        "admin_driver_directory",
      )
    ).find((p) => p.email === "pending@test.example")?.approval_status,
  ).toBe("PENDING");
  await call("save_driver_account", [
    direct,
    "Approved on creation",
    "123",
    0,
    true,
    "Explicit authorization",
    randomUUID(),
  ]);
  const record = (
    await db.query<Record<string, unknown>>(
      "select approval_status,is_active,approved_by,approved_at from public.profiles where id=$1",
      [direct],
    )
  ).rows[0]!;
  expect(record).toMatchObject({
    approval_status: "APPROVED",
    is_active: true,
    approved_by: admin,
  });
  expect(record.approved_at).not.toBeNull();
});
it("approval is admin-only, version checked, idempotent and audited", async () => {
  await call("save_driver_account", [
    pending,
    "Pending Driver",
    "",
    0,
    false,
    "Initial account review",
    randomUUID(),
  ]);
  await actor(pending);
  await denied("change_driver_status", [
    pending,
    "APPROVED",
    1,
    "Self approval",
    randomUUID(),
  ]);
  await denied("save_driver_account", [
    pending,
    "Forged name",
    "",
    1,
    true,
    "Self approval",
    randomUUID(),
  ]);
  await db.exec("savepoint direct_write");
  await expect(
    db.query<Record<string, unknown>>(
      "update public.profiles set role='ADMIN',is_active=true,approval_status='APPROVED' where id=$1",
      [pending],
    ),
  ).rejects.toThrow(/permission denied/);
  await db.exec("rollback to savepoint direct_write");
  await actor(admin);
  await denied(
    "change_driver_status",
    [pending, "APPROVED", 9, "Stale approval", randomUUID()],
    /Record changed/,
  );
  const key = randomUUID(),
    args = [pending, "APPROVED", 1, "Reviewed identity", key];
  await call("change_driver_status", args);
  await call("change_driver_status", args);
  expect(
    (
      await db.query<Record<string, unknown>>(
        "select * from public.audit_events where action='DRIVER_STATUS_CHANGED' and entity_id=$1",
        [pending],
      )
    ).rows,
  ).toHaveLength(1);
  await actor(pending);
  expect(await call<boolean>("has_operational_access")).toBe(true);
  // Approval never assigns another driver's trip or warehouse permissions.
  expect(
    (await db.query<Record<string, unknown>>("select * from public.trips"))
      .rows,
  ).toEqual([]);
  await denied("adjust_warehouse_stock", [
    jar,
    "FULL_JAR",
    1,
    "Forbidden",
    "",
    day,
    randomUUID(),
  ]);
});
it("suspends an assigned driver with an existing identity and immediately blocks reads and posting", async () => {
  await actor(driver);
  expect(
    (await db.query<Record<string, unknown>>("select * from public.sales"))
      .rows,
  ).toHaveLength(1);
  await actor(admin);
  await call("change_driver_status", [
    driver,
    "SUSPENDED",
    1,
    "Safety review",
    randomUUID(),
  ]);
  await actor(driver);
  expect(await call<boolean>("has_operational_access")).toBe(false);
  for (const table of [
    "trips",
    "sales",
    "inventory_balances",
    "visit_items",
    "payments",
  ])
    expect(
      (await db.query<Record<string, unknown>>(`select * from public.${table}`))
        .rows,
    ).toEqual([]);
  await denied("submit_trip", [trip, "[]", randomUUID()]);
  await denied("post_driver_delivery", [
    trip,
    customer,
    "",
    "",
    "[]",
    "PAID",
    "0",
    "",
    randomUUID(),
  ]);
  // Updating a name while suspended never changes access.
  await call("save_own_profile", ["Correct Actual Name", "", 2, randomUUID()]);
  expect(
    (
      await db.query<Record<string, unknown>>(
        "select name,approval_status,is_active from public.profiles where id=$1",
        [driver],
      )
    ).rows[0],
  ).toMatchObject({
    name: "Correct Actual Name",
    approval_status: "SUSPENDED",
    is_active: false,
  });
  await actor(admin);
  expect(
    (
      await db.query<Record<string, unknown>>(
        "select * from public.trips where id=$1",
        [trip],
      )
    ).rows,
  ).toHaveLength(1);
  await db.exec("reset role");
  expect(await history()).toBe(legacyBefore);
});
it("rejects and reactivates accounts without deleting users or changing first recorded approval", async () => {
  await call("save_driver_account", [
    pending,
    "Pending Driver",
    "",
    0,
    false,
    "Initial review",
    randomUUID(),
  ]);
  await call("change_driver_status", [
    pending,
    "REJECTED",
    1,
    "Identity not verified",
    randomUUID(),
  ]);
  await actor(pending);
  expect(await call<boolean>("has_operational_access")).toBe(false);
  await actor(admin);
  await call("change_driver_status", [
    pending,
    "APPROVED",
    2,
    "Identity now verified",
    randomUUID(),
  ]);
  const first = (
    await db.query<Record<string, unknown>>(
      "select approved_at from public.profiles where id=$1",
      [pending],
    )
  ).rows[0]!.approved_at;
  await call("change_driver_status", [
    pending,
    "SUSPENDED",
    3,
    "Temporary suspension",
    randomUUID(),
  ]);
  await call("change_driver_status", [
    pending,
    "APPROVED",
    4,
    "Review complete",
    randomUUID(),
  ]);
  expect(
    (
      await db.query<Record<string, unknown>>(
        "select approved_at from public.profiles where id=$1",
        [pending],
      )
    ).rows[0]!.approved_at,
  ).toEqual(first);
  await actor(pending);
  expect(await call<boolean>("has_operational_access")).toBe(true);
});
it("prevents legacy activation bypasses and preserves admin profiles", async () => {
  await call("save_driver", [
    pending,
    "Legacy provisioner",
    true,
    0,
    "Legacy provisioning",
    randomUUID(),
  ]);
  expect(
    (
      await db.query<Record<string, unknown>>(
        "select approval_status,is_active from public.profiles where id=$1",
        [pending],
      )
    ).rows[0],
  ).toMatchObject({ approval_status: "PENDING", is_active: false });
  await denied(
    "save_driver",
    [pending, "Bypass attempt", true, 1, "Hidden activation", randomUUID()],
    /approval action/,
  );
  await denied(
    "change_driver_status",
    [admin, "SUSPENDED", 1, "Wrong role", randomUUID()],
    /Only driver/,
  );
  await db.exec("reset role;savepoint invariant");
  await expect(
    db.query<Record<string, unknown>>(
      "update public.profiles set is_active=true where id=$1",
      [pending],
    ),
  ).rejects.toThrow(/driver_approval_active_consistent/);
  await db.exec("rollback to savepoint invariant");
});
it("limits own-profile changes to name and phone, scopes admin email directory and denies anonymous calls", async () => {
  await actor(driver);
  await call("save_own_profile", ["Ram Thapa", "123", 1, randomUUID()]);
  expect(
    (
      await db.query<Record<string, unknown>>(
        "select id,role,is_active,approval_status from public.profiles where id=$1",
        [driver],
      )
    ).rows[0],
  ).toMatchObject({
    id: driver,
    role: "DRIVER",
    is_active: true,
    approval_status: "APPROVED",
  });
  await denied("admin_driver_directory", [], /Admin access/);
  await actor(null, "anon");
  await denied("save_own_profile", ["Anonymous", "", 0, randomUUID()]);
  await denied("change_driver_status", [
    driver,
    "SUSPENDED",
    2,
    "Anonymous",
    randomUUID(),
  ]);
  await denied("admin_driver_directory", []);
});
