import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, beforeEach, afterEach, it, expect } from "vitest";
import type { DeliveryCustomerContext } from "@/domain/operations/customer-context";
import type { FinanceWorkspace } from "@/domain/finance/types";
import type { Workspace } from "@/domain/operations/types";
import { reportRows } from "@/domain/business-days/reports";
let db: PGlite, day: string;
const admin = randomUUID(),
  driver = randomUUID(),
  other = randomUUID(),
  jar = randomUUID(),
  carton = randomUUID(),
  vehicle = randomUUID(),
  existing = randomUUID(),
  trip = randomUUID();
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
async function rejected(name: string, args: unknown[], message: RegExp) {
  await db.exec("savepoint rejected");
  try {
    await expect(rpc(name, args)).rejects.toThrow(message);
  } finally {
    await db.exec("rollback to savepoint rejected");
  }
}
const finance = () => rpc<FinanceWorkspace>("finance_workspace", []);
const workspace = () => rpc<Workspace>("operations_workspace", [trip]);
const context = (id: string = existing) =>
  rpc<DeliveryCustomerContext>("delivery_customer_context", [trip, id]);
const contact = (
  id = randomUUID(),
  name = "New driver customer",
  phone = "9812345678",
  version = 0,
  key = randomUUID(),
  duplicate = false,
) =>
  rpc("save_delivery_customer", [
    trip,
    id,
    name,
    "Shop",
    phone,
    "Kathmandu",
    version,
    duplicate,
    key,
  ]);
const items = (full: number, empty: number, cartons = 0) =>
  JSON.stringify([
    { product_id: jar, full_jars: full, empty_jars: empty, cartons: 0 },
    ...(cartons
      ? [{ product_id: carton, full_jars: 0, empty_jars: 0, cartons }]
      : []),
  ]);
const visit = (
  customer: string | null,
  full: number,
  empty: number,
  payment = { selection: "CASH" },
  key = randomUUID(),
) =>
  rpc("post_trip_visit", [
    trip,
    customer,
    "",
    "",
    items(full, empty),
    JSON.stringify(payment),
    "",
    key,
  ]);
async function start() {
  await rpc("load_trip", [
    trip,
    JSON.stringify([
      { product_id: jar, stock_kind: "FULL_JAR", quantity: 80 },
      { product_id: carton, stock_kind: "BOTTLE_CARTON", quantity: 2 },
    ]),
    randomUUID(),
  ]);
  await who(driver);
  await rpc("transition_trip", [trip, "START", "", randomUUID()]);
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,email text);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;`);
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
      "Disposable test",
      randomUUID(),
    ]);
  day = await rpc("open_inventory_business_day", [randomUUID()]);
  for (const [id, kind, qty] of [
    [jar, "FULL_JAR", 100],
    [carton, "BOTTLE_CARTON", 10],
  ])
    await rpc("adjust_warehouse_stock", [
      id,
      kind,
      qty,
      "Disposable stock",
      "",
      day,
      randomUUID(),
    ]);
  await rpc("save_vehicle", [
    vehicle,
    "TEST-80",
    "",
    true,
    0,
    "Disposable vehicle",
    randomUUID(),
  ]);
  await rpc("save_customer", [
    existing,
    "Existing customer",
    "",
    "",
    "",
    "Private admin contact note",
    true,
    0,
    "Existing identity",
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
  await db.exec("rollback;reset role");
});

it("upgrades an existing closed trip/day without changing users, journals, archives or earlier retry results", async () => {
  const legacy = new PGlite();
  try {
    await legacy.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema auth to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;`);
    const files = readdirSync("supabase/migrations").sort();
    for (const file of files.filter((f) => f < "202610120012"))
      await legacy.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
    async function call<T = string>(name: string, args: unknown[]) {
      return (
        await legacy.query<{ value: T }>(
          `select public.${name}(${args.map((_, i) => `$${i + 1}`).join(",")}) as value`,
          args,
        )
      ).rows[0]!.value;
    }
    await legacy.query("insert into auth.users(id) values($1),($2)", [
      admin,
      driver,
    ]);
    await legacy.query(
      "insert into public.profiles(id,name,role) values($1,'Legacy admin','ADMIN'),($2,'Legacy driver','DRIVER')",
      [admin, driver],
    );
    const identity = (id: string) =>
      legacy.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
    await identity(admin);
    await call("save_product", [
      jar,
      "LEGACY-JAR",
      "Legacy jar",
      "FULL_JAR",
      "unit",
      "150.25",
      true,
      0,
      "Legacy product",
      randomUUID(),
    ]);
    const oldDay = await call("open_inventory_business_day", [randomUUID()]);
    await call("adjust_warehouse_stock", [
      jar,
      "FULL_JAR",
      10,
      "Legacy stock",
      "",
      oldDay,
      randomUUID(),
    ]);
    await call("save_customer", [
      existing,
      "Legacy customer",
      "",
      "",
      "",
      "",
      true,
      0,
      "Legacy customer",
      randomUUID(),
    ]);
    await call("save_vehicle", [
      vehicle,
      "LEGACY",
      "",
      true,
      0,
      "Legacy vehicle",
      randomUUID(),
    ]);
    const createKey = randomUUID(),
      visitKey = randomUUID(),
      collectionKey = randomUUID();
    const createArgs = [
      trip,
      driver,
      vehicle,
      oldDay,
      JSON.stringify([existing]),
      "",
      createKey,
    ];
    await call("create_trip", createArgs);
    await call("load_trip", [
      trip,
      JSON.stringify([
        { product_id: jar, stock_kind: "FULL_JAR", quantity: 10 },
      ]),
      randomUUID(),
    ]);
    await identity(driver);
    await call("transition_trip", [trip, "START", "", randomUUID()]);
    const visitArgs = [
      trip,
      existing,
      "",
      "",
      items(1, 1),
      '{"selection":"UNPAID"}',
      "",
      visitKey,
    ];
    const oldVisit = await call("post_trip_visit", visitArgs);
    const oldInvoice = (await call<FinanceWorkspace>("finance_workspace", []))
      .invoices[0]!;
    const collectionArgs = [
      "PAYMENT",
      JSON.stringify({
        trip,
        customer: existing,
        method: "CASH",
        amount: "150.25",
        allocations: [{ invoice_id: oldInvoice.id, amount: "150.25" }],
      }),
      collectionKey,
    ];
    const oldPayment = await call("finance_command", collectionArgs);
    const oldCounts = JSON.stringify([
      { product_id: jar, stock_kind: "FULL_JAR", quantity: 9 },
      { product_id: jar, stock_kind: "EMPTY_JAR", quantity: 1 },
    ]);
    await call("submit_trip", [trip, oldCounts, randomUUID()]);
    await identity(admin);
    const legacyCustody = await call("adjust_customer_custody", [
      existing,
      jar,
      5,
      oldDay,
      "Verified legacy custody",
      randomUUID(),
    ]);
    await call("reconcile_trip", [
      trip,
      oldCounts,
      "Legacy physical approval",
      false,
      randomUUID(),
    ]);
    await call("business_day_command", [
      "REVIEW",
      oldDay,
      '{"version":1}',
      randomUUID(),
    ]);
    await call("business_day_command", [
      "CLOSE",
      oldDay,
      JSON.stringify({
        version: 2,
        cash_counted: "150.25",
        notes: "Legacy closing evidence",
        cash_checked: true,
        fonepay_checked: true,
        stock_checked: true,
        balances_checked: true,
        confirmed: true,
      }),
      randomUUID(),
    ]);
    const snapshot = async () =>
      (
        await legacy.query<{ value: unknown }>(`select jsonb_build_object(
      'users',(select jsonb_agg(id order by id) from auth.users),
      'profiles',(select jsonb_agg(to_jsonb(p) order by id) from public.profiles p),
      'customers',(select jsonb_agg(to_jsonb(c)-'created_by' order by id) from public.customers c),
      'trips',(select jsonb_agg(to_jsonb(t) order by id) from public.trips t),
      'visits',(select jsonb_agg(to_jsonb(v) order by id) from public.trip_visits v),
      'stock',(select jsonb_agg(to_jsonb(m) order by id) from public.stock_movements m),
      'finance',(select jsonb_agg(to_jsonb(j) order by id) from public.finance_journal j),
      'custody',(select jsonb_agg(to_jsonb(j) order by id) from public.jar_custody_entries j),
      'archive',(select jsonb_agg(to_jsonb(c) order by business_day_id) from public.business_day_closings c),
      'requests',(select jsonb_agg(to_jsonb(r) order by actor_user_id,idempotency_key) from public.operation_requests r),
      'audit',(select jsonb_agg(to_jsonb(a) order by id) from public.audit_events a)) as value`)
      ).rows[0]!.value;
    const before = await snapshot();
    await legacy.exec(
      readFileSync(
        "supabase/migrations/202610120012_driver_customer_workflow.sql",
        "utf8",
      ),
    );
    await legacy.exec(
      readFileSync(
        "supabase/migrations/202610120013_sprint6_pending_jars.sql",
        "utf8",
      ),
    );
    const legacyPending = await call<{
      rows: import("@/domain/operations/pending-jars").PendingJar[];
    }>("pending_jar_workspace", [null, existing]);
    expect(legacyPending.rows).toHaveLength(1);
    expect(legacyPending.rows[0]).toMatchObject({
      entry_id: legacyCustody,
      pending: 5,
      source: "Admin custody correction",
    });
    expect(await snapshot()).toEqual(before);
    expect(await call("create_trip", createArgs)).toBe(trip);
    await identity(driver);
    expect(await call("post_trip_visit", visitArgs)).toBe(oldVisit);
    expect(await call("finance_command", collectionArgs)).toBe(oldPayment);
    expect(await snapshot()).toEqual(before);
  } finally {
    await legacy.close();
  }
}, 30000);

it("80 loaded, driver creates/selects/walks/revisits customers, sells 70, collects 40 empties and submits 10 remaining", async () => {
  await start();
  expect((await workspace()).route).toHaveLength(0);
  const created = await contact();
  await visit(created, 20, 5);
  await visit(existing, 25, 15, {
    selection: "PARTIAL",
    reported_amount: "1000",
  } as { selection: string });
  await visit(null, 10, 10);
  await visit(created, 15, 10, { selection: "UNPAID" });
  let w = await workspace(),
    f = await finance();
  expect(w.visits).toHaveLength(4);
  expect(w.visits.filter((v) => v.customer_id === created)).toHaveLength(2);
  expect(w.visits.find((v) => v.customer_id === null)?.walk_in_name).toBe(
    "Walk-in customer",
  );
  expect(w.balances.find((b) => b.stock_kind === "FULL_JAR")?.quantity).toBe(
    10,
  );
  expect(w.balances.find((b) => b.stock_kind === "EMPTY_JAR")?.quantity).toBe(
    40,
  );
  expect((await context(created)).custody[0]?.quantity).toBe(20);
  expect((await context(existing)).custody[0]?.quantity).toBe(10);
  expect(f.invoices).toHaveLength(4);
  expect(f.payments).toHaveLength(3);
  expect(f.credit.reduce((n, c) => n + Number(c.outstanding), 0)).toBe(5010);
  const before = JSON.stringify(w.movements);
  await rejected(
    "post_trip_visit",
    [
      trip,
      created,
      "",
      "",
      items(11, 0),
      '{"selection":"CASH"}',
      "",
      randomUUID(),
    ],
    /negative|stock/,
  );
  expect(JSON.stringify((await workspace()).movements)).toBe(before);
  const counts = JSON.stringify([
    { product_id: jar, stock_kind: "FULL_JAR", quantity: 10 },
    { product_id: jar, stock_kind: "EMPTY_JAR", quantity: 40 },
    { product_id: carton, stock_kind: "BOTTLE_CARTON", quantity: 2 },
  ]);
  await rpc("submit_trip", [trip, counts, randomUUID()]);
  await rejected(
    "post_trip_visit",
    [
      trip,
      created,
      "",
      "",
      items(1, 0),
      '{"selection":"CASH"}',
      "",
      randomUUID(),
    ],
    /ACTIVE/,
  );
  await who();
  w = await workspace();
  f = await finance();
  expect(w.trips[0]?.status).toBe("SUBMITTED");
  expect(w.customers.find((c) => c.id === created)).toMatchObject({
    created_by: driver,
    created_by_name: "Driver",
  });
  expect(
    f.sales.every((s) => s.trip_id === trip && s.driver_id === driver),
  ).toBe(true);
  expect(
    f.payments.every(
      (p) => p.actor_user_id === driver && p.status === "CONFIRMED",
    ),
  ).toBe(true);
  await rpc("reconcile_trip", [
    trip,
    counts,
    "Actual physical stock verified",
    false,
    randomUUID(),
  ]);
  expect((await workspace()).trips[0]?.status).toBe("CLOSED");
  await db.exec("reset role");
  expect(
    await scalar(
      "select count(*) from (select posting_id from public.finance_journal group by posting_id having sum(amount)<>0) x",
    ),
  ).toBe(0);
  expect(
    await scalar(
      "select sum(amount)::text from public.finance_journal where account='SALES'",
    ),
  ).toBe("-10517.50");
  expect(
    await scalar(
      "select sum(amount)::text from public.finance_journal where account='CASH'",
    ),
  ).toBe("5507.50");
  expect(
    await scalar(
      "select count(*) from public.inventory_balances b where quantity<>(select coalesce(sum(case when to_location_id=b.location_id then quantity else 0 end-case when from_location_id=b.location_id then quantity else 0 end),0) from public.stock_movements m where m.product_id=b.product_id and m.stock_kind=b.stock_kind)",
    ),
  ).toBe(0);
});
it("driver contact creation and same-key retries preserve creator and immutable audit attribution", async () => {
  await start();
  const id = randomUUID(),
    key = randomUUID();
  expect(await contact(id, "Created once", "", 0, key)).toBe(id);
  expect(await contact(id, "Created once", "", 0, key)).toBe(id);
  await db.exec("reset role");
  expect(
    await scalar("select created_by from public.customers where id=$1", [id]),
  ).toBe(driver);
  expect(
    await scalar(
      "select count(*) from public.audit_events where entity_id=$1 and action='CUSTOMER_CREATED'",
      [id],
    ),
  ).toBe(1);
  await who(driver);
  await rejected(
    "save_delivery_customer",
    [trip, id, "Changed", "Shop", "", "Kathmandu", 0, false, key],
    /different request/,
  );
});
it("normalized duplicate phone/name detection requires an explicit separately audited confirmation", async () => {
  await start();
  await contact(randomUUID(), "First", "98 123 45678");
  const id = randomUUID(),
    key = randomUUID();
  await rejected(
    "save_delivery_customer",
    [trip, id, "Second", "Shop", "9812345678", "", 0, false, key],
    /matching customer/,
  );
  expect(
    await rpc("save_delivery_customer", [
      trip,
      id,
      "Second",
      "Shop",
      "9812345678",
      "",
      0,
      true,
      key,
    ]),
  ).toBe(id);
  await db.exec("reset role");
  expect(
    await scalar(
      "select after_json->>'duplicate_confirmed' from public.audit_events where entity_id=$1",
      [id],
    ),
  ).toBe("true");
});
it("drivers edit contact fields with stale-version protection, without touching status, prices, credit or custody", async () => {
  await rpc("finance_command", [
    "PRICE",
    JSON.stringify({
      customer: existing,
      product: jar,
      price: "145",
      active: true,
      version: 0,
      reason: "Existing negotiated rate",
    }),
    randomUUID(),
  ]);
  await start();
  await visit(existing, 2, 1, { selection: "UNPAID" });
  const before = await context();
  await contact(existing, "Updated contact", "9800000000", 1);
  const after = await context();
  expect(after.customer).toMatchObject({
    name: "Updated contact",
    version: 2,
    is_active: true,
    created_by: admin,
  });
  expect(after.credit).toEqual(before.credit);
  expect(after.custody).toEqual(before.custody);
  expect(after.prices).toEqual(before.prices);
  await rejected(
    "save_delivery_customer",
    [trip, existing, "Stale", "Shop", "", "", 1, false, randomUUID()],
    /changed/,
  );
  await who();
  expect((await finance()).invoices[0]?.customer.name).toBe(
    "Existing customer",
  );
});
it("directory reads allow all active contacts during an assigned ACTIVE trip and keep other trips/warehouse/finance hidden", async () => {
  const hidden = randomUUID();
  await rpc("save_customer", [
    hidden,
    "Inactive",
    "",
    "",
    "",
    "",
    false,
    0,
    "Inactive identity",
    randomUUID(),
  ]);
  await start();
  const w = await workspace();
  expect(w.customers.map((c) => c.id)).toContain(existing);
  expect(w.customers.map((c) => c.id)).not.toContain(hidden);
  expect(w.locations.every((l) => l.code !== "MAIN")).toBe(true);
  expect(await scalar("select count(*) from public.customers")).toBe(0);
  expect(w.customers.every((c) => c.notes === "")).toBe(true);
  expect((await context()).customer.notes).toBe("");
  await who();
  expect((await context()).customer.notes).toBe("Private admin contact note");
  expect((await finance()).journal).toEqual([]);
  await who(other);
  expect(await scalar("select count(*) from public.customers")).toBe(0);
  await rejected("delivery_customer_context", [trip, existing], /access/);
  await rejected(
    "save_delivery_customer",
    [trip, randomUUID(), "Forged", "", "", "", 0, false, randomUUID()],
    /access/,
  );
});
it("driver cannot load, adjust warehouse/custody, reconcile, close, preassign or execute private posting cores", async () => {
  await start();
  for (const [name, args] of [
    ["load_trip", [trip, "[]", randomUUID()]],
    [
      "adjust_warehouse_stock",
      [jar, "FULL_JAR", 1, "Forbidden", "", day, randomUUID()],
    ],
    ["reconcile_trip", [trip, "[]", "Forbidden", true, randomUUID()]],
    [
      "adjust_customer_custody",
      [existing, jar, 1, day, "Forbidden", randomUUID()],
    ],
    ["business_day_command", ["REVIEW", day, '{"version":1}', randomUUID()]],
    ["assign_trip_customer", [trip, existing, randomUUID()]],
    [
      "post_trip_visit_core",
      [
        trip,
        existing,
        "",
        "",
        items(1, 0),
        '{"selection":"CASH"}',
        "",
        randomUUID(),
      ],
    ],
    ["finance_command_core", ["PAYMENT", "{}", randomUUID()]],
    [
      "create_trip_core",
      [randomUUID(), driver, vehicle, day, "[]", "", randomUUID()],
    ],
  ] as [string, unknown[]][])
    await rejected(name, args, /authorized|permission|admin required/);
  await db.exec("savepoint direct");
  await expect(
    db.query("update public.customers set is_active=false where id=$1", [
      existing,
    ]),
  ).rejects.toThrow(/permission/);
  await db.exec("rollback to savepoint direct");
});
it("new admin destination preassignment is rejected without changing existing customer associations", async () => {
  await rejected(
    "assign_trip_customer",
    [trip, existing, randomUUID()],
    /preassignment/,
  );
  await rejected(
    "create_trip",
    [
      randomUUID(),
      other,
      vehicle,
      day,
      JSON.stringify([existing]),
      "",
      randomUUID(),
    ],
    /destinations/,
  );
  expect(await scalar("select count(*) from public.trip_customers")).toBe(0);
});
it("admin can act on a driver's trip with its own contact, sale, payment and submission attribution", async () => {
  await start();
  await who();
  const id = await contact(randomUUID(), "Admin assisted customer", "");
  await visit(id, 5, 2);
  expect((await finance()).payments[0]?.actor_user_id).toBe(admin);
  await db.exec("reset role");
  expect(
    await scalar(
      "select actor_user_id from public.trip_visits where customer_id=$1",
      [id],
    ),
  ).toBe(admin);
  expect(
    await scalar("select created_by from public.customers where id=$1", [id]),
  ).toBe(admin);
  await who();
  await rpc("submit_trip", [
    trip,
    JSON.stringify([
      { product_id: jar, stock_kind: "FULL_JAR", quantity: 75 },
      { product_id: jar, stock_kind: "EMPTY_JAR", quantity: 2 },
      { product_id: carton, stock_kind: "BOTTLE_CARTON", quantity: 2 },
    ]),
    randomUUID(),
  ]);
  expect((await workspace()).trips[0]?.status).toBe("SUBMITTED");
});
it("duplicate delivery requests create one visit, invoice, receipt and inventory set for a newly chosen customer", async () => {
  await start();
  const id = await contact(),
    key = randomUUID();
  const saved = await visit(id, 20, 5, { selection: "CASH" }, key);
  const before = await workspace();
  expect(await visit(id, 20, 5, { selection: "CASH" }, key)).toBe(saved);
  expect((await workspace()).movements).toEqual(before.movements);
  expect((await finance()).invoices).toHaveLength(1);
  expect((await finance()).payments).toHaveLength(1);
  expect((await workspace()).route).toHaveLength(1);
});
it("a failed visit never retains an association, invoice, payment or custody mutation", async () => {
  await start();
  await rejected(
    "post_trip_visit",
    [
      trip,
      existing,
      "",
      "",
      items(81, 1),
      '{"selection":"CASH"}',
      "",
      randomUUID(),
    ],
    /negative|stock/,
  );
  expect((await workspace()).route).toHaveLength(0);
  expect((await context()).custody).toHaveLength(0);
  expect((await finance()).invoices).toHaveLength(0);
  expect((await finance()).payments).toHaveLength(0);
});
it("Fonepay for a driver-created customer remains pending and does not settle credit", async () => {
  await start();
  const id = await contact();
  await visit(id, 3, 1, { selection: "FONEPAY" });
  const f = await finance();
  expect(f.payments[0]).toMatchObject({
    status: "PENDING",
    method: "FONEPAY",
    amount: "450.75",
  });
  expect((await context(id)).credit[0]).toMatchObject({
    outstanding: "450.75",
    available: "0.00",
  });
});
it("contact/context operations require an active account, active trip and OPEN business day", async () => {
  await who(driver);
  await rejected(
    "save_delivery_customer",
    [trip, randomUUID(), "Too early", "", "", "", 0, false, randomUUID()],
    /ACTIVE/,
  );
  await who();
  await start();
  await db.exec("reset role");
  await db.query(
    "update public.business_days set status='CLOSING_REVIEW' where id=$1",
    [day],
  );
  await who(driver);
  await rejected("delivery_customer_context", [trip, existing], /OPEN/);
  await rejected(
    "save_delivery_customer",
    [trip, randomUUID(), "Frozen", "", "", "", 0, false, randomUUID()],
    /OPEN/,
  );
  await db.exec("reset role");
  await db.query("update public.profiles set is_active=false where id=$1", [
    driver,
  ]);
  await who(driver);
  await rejected("delivery_customer_context", [trip, existing], /authorized/);
  await db.exec("set role anon;savepoint anonymous");
  await expect(
    db.query("select public.delivery_customer_context($1,$2)", [
      trip,
      existing,
    ]),
  ).rejects.toThrow(/permission/);
  await db.exec("rollback to savepoint anonymous");
});

it("FIFO: 20 delivered / 15 returned leaves 5; 10 delivered / 12 returned settles the oldest 5 and leaves 3 on the original second date", async () => {
  await start();
  const first = await visit(existing, 20, 15, { selection: "UNPAID" });
  const initial = await context();
  expect(initial.pending_jars).toHaveLength(1);
  expect(initial.pending_jars![0]).toMatchObject({ pending: 5, quantity: 20 });
  const second = await visit(existing, 10, 12);
  const next = await context();
  expect(next.pending_jars).toHaveLength(1);
  expect(next.pending_jars![0]).toMatchObject({ pending: 3, quantity: 10 });
  await db.exec("reset role");
  const origins = (
    await db.query<{ id: string; created_at: Date; visit_id: string }>(
      "select id,created_at,visit_id from public.jar_custody_entries where delta>0 order by (select sequence from public.custody_event_order where entry_id=id)",
    )
  ).rows;
  expect(next.pending_jars![0]!.entry_id).toBe(
    origins.find((e) => e.visit_id === second)!.id,
  );
  expect(new Date(next.pending_jars![0]!.original_date).toISOString()).toBe(
    origins.find((e) => e.visit_id === second)!.created_at.toISOString(),
  );
  const firstOrigin = origins.find((e) => e.visit_id === first)!.id;
  expect(
    next
      .jar_allocations!.filter((a) => a.delivery_entry_id === firstOrigin)
      .map((a) => a.quantity),
  ).toEqual([15, 5]);
  expect(
    next
      .jar_allocations!.filter((a) => a.delivery_entry_id !== firstOrigin)
      .map((a) => a.quantity),
  ).toEqual([7]);
  expect(
    await scalar("select sum(delta) from public.jar_custody_entries"),
  ).toBe(3);
});
it("empty-only collection posts custody/stock/audit, no new sale/invoice, and retries produce one return allocation", async () => {
  await start();
  await visit(existing, 20, 15, { selection: "UNPAID" });
  const before = await finance();
  const key = randomUUID();
  const saved = await visit(existing, 0, 3, { selection: "CASH" }, key);
  expect(await visit(existing, 0, 3, { selection: "CASH" }, key)).toBe(saved);
  const after = await finance();
  expect(after.sales).toEqual(before.sales);
  expect(after.invoices).toEqual(before.invoices);
  expect(after.credit).toEqual(before.credit);
  expect(after.payments).toEqual(before.payments);
  expect((await context()).pending_jars![0]!.pending).toBe(2);
  await who();
  expect(await scalar("select count(*) from public.return_only_visits")).toBe(
    1,
  );
  const preview = await rpc<{ blockers: { code: string }[] }>(
    "business_day_report",
    [day],
  );
  expect(preview.blockers.some((b) => b.code === "UNPOSTED_VISIT")).toBe(false);
  await who(driver);
  await rejected(
    "post_trip_visit",
    [
      trip,
      existing,
      "",
      "",
      items(0, 3),
      '{"selection":"CASH"}',
      "",
      randomUUID(),
    ],
    /balance/,
  );
  expect((await context()).pending_jars![0]!.pending).toBe(2);
});
it("return-only visits can collect explicitly allocated old credit without creating another invoice", async () => {
  await start();
  await visit(existing, 20, 15, { selection: "UNPAID" });
  const invoice = (await finance()).invoices[0]!;
  await rpc("post_trip_visit", [
    trip,
    existing,
    "",
    "",
    items(0, 2),
    JSON.stringify({
      selection: "CASH",
      payments: [
        {
          method: "CASH",
          amount: "50",
          current_amount: "0",
          allocations: [{ invoice_id: invoice.id, amount: "50" }],
        },
      ],
    }),
    "",
    randomUUID(),
  ]);
  const f = await finance();
  expect(f.invoices).toHaveLength(1);
  expect(f.sales).toHaveLength(1);
  expect(f.payments).toHaveLength(1);
  expect(f.credit[0]!.outstanding).toBe("2955.00");
  expect((await context()).pending_jars![0]!.pending).toBe(3);
});
it("pending-jar reads and private FIFO helpers enforce active account/owned trip/day and deny forged order writes", async () => {
  await start();
  await visit(existing, 20, 15);
  expect(
    (await rpc<{ rows: unknown[] }>("pending_jar_workspace", [trip, null]))
      .rows,
  ).toHaveLength(1);
  await who(other);
  await rejected("pending_jar_workspace", [trip, null], /assigned/);
  for (const fn of [
    "pending_jar_rows",
    "jar_return_allocations",
    "delivery_customer_context_core",
    "finance_issue_visit",
    "finance_issue_visit_core",
    "day_report_data",
    "day_report_data_core",
  ]) {
    expect(
      await scalar(
        "select has_function_privilege('authenticated',p.oid,'execute') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=$1",
        [fn],
      ),
    ).toBe(false);
  }
  await expect(
    db.exec(
      "insert into public.custody_event_order(entry_id) values(gen_random_uuid())",
    ),
  ).rejects.toThrow(/permission denied/);
  await db.exec("rollback;begin");
});
it("new closing snapshots freeze dated pending jars; next business day carries original dates with fresh counters", async () => {
  await start();
  await visit(existing, 20, 15, { selection: "UNPAID" });
  await visit(existing, 10, 12, { selection: "UNPAID" });
  const counts = JSON.stringify([
    { product_id: jar, stock_kind: "FULL_JAR", quantity: 50 },
    { product_id: jar, stock_kind: "EMPTY_JAR", quantity: 27 },
    { product_id: carton, stock_kind: "BOTTLE_CARTON", quantity: 2 },
  ]);
  await rpc("submit_trip", [trip, counts, randomUUID()]);
  await who();
  await rpc("reconcile_trip", [
    trip,
    counts,
    "Physical counts checked",
    false,
    randomUUID(),
  ]);
  await rpc("business_day_command", [
    "REVIEW",
    day,
    '{"version":1}',
    randomUUID(),
  ]);
  await rpc("business_day_command", [
    "CLOSE",
    day,
    JSON.stringify({
      version: 2,
      cash_counted: "0",
      notes: "Verified close",
      cash_checked: true,
      fonepay_checked: true,
      stock_checked: true,
      balances_checked: true,
      confirmed: true,
    }),
    randomUUID(),
  ]);
  const archived = await rpc<{
    report: import("@/domain/business-days/types").DayReport;
  }>("business_day_report", [day]);
  expect(archived.report.pending_jars![0]!.pending).toBe(3);
  expect(
    reportRows(archived.report).find(
      (r) => r.section === "Pending jars by original date",
    ),
  ).toMatchObject({ quantity: 3 });
  const nextDay = await rpc("open_inventory_business_day", [randomUUID()]);
  const next = await rpc<{
    report: import("@/domain/business-days/types").DayReport;
  }>("business_day_report", [nextDay]);
  expect(next.report.pending_jars).toEqual(archived.report.pending_jars);
  expect(next.report.totals).toMatchObject({
    sales: "0",
    collections: "0",
    trips: 0,
    outstanding: "4507.50",
  });
  await rpc("adjust_customer_custody", [
    existing,
    jar,
    -1,
    nextDay,
    "Verified legacy return correction",
    randomUUID(),
  ]);
  expect(
    (
      await rpc<{
        rows: import("@/domain/operations/pending-jars").PendingJar[];
      }>("pending_jar_workspace", [null, existing])
    ).rows[0]!.pending,
  ).toBe(2);
  expect(await rpc("business_day_report", [day])).toEqual(archived);
});

it("FIFO ordering and return-only markers reject updates, deletes and truncation even with owner-level DML", async () => {
  await start();
  await visit(existing, 20, 15);
  await visit(existing, 0, 2);
  await db.exec("reset role");
  for (const table of ["custody_event_order", "return_only_visits"]) {
    for (const sql of [
      table === "custody_event_order"
        ? "update public.custody_event_order set entry_id=entry_id"
        : "update public.return_only_visits set visit_id=visit_id",
      "delete from public." + table,
      "truncate public." + table,
    ]) {
      await db.exec("savepoint immutable_check");
      try {
        await expect(db.exec(sql)).rejects.toThrow(/append|immutable/i);
      } finally {
        await db.exec("rollback to savepoint immutable_check");
      }
    }
  }
  await who(driver);
  expect((await context()).pending_jars![0]!.pending).toBe(3);
});
