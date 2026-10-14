import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID, createHash } from "node:crypto";
import { beforeAll, afterAll, beforeEach, afterEach, it, expect } from "vitest";
import { canonical } from "@/domain/offline/operations";
import type { Workspace } from "@/domain/operations/types";
import type { FinanceWorkspace } from "@/domain/finance/types";
import type { DeliveryCustomerContext } from "@/domain/operations/customer-context";
import type { HouseWorkspace } from "@/domain/house/types";
import type { Receipt, DeliveryDraft } from "@/domain/offline/types";
const admin = randomUUID(),
  driver = randomUUID(),
  other = randomUUID(),
  jar = randomUUID(),
  carton = randomUUID(),
  vehicle = randomUUID(),
  house = randomUUID(),
  regular = randomUUID(),
  trip = randomUUID(),
  device = randomUUID(),
  token = "c".repeat(64);
let db: PGlite, day: string;
async function actor(id: string) {
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
async function denied(
  name: string,
  args: unknown[],
  pattern = /authorized|permission|admin|approved|approval|eligible|payment|immutable/i,
) {
  await db.exec("savepoint denied");
  await expect(call(name, args)).rejects.toThrow(pattern);
  await db.exec("rollback to savepoint denied");
}
async function houseSave(
  status = "APPROVED",
  version = 1,
  id = house,
  type = "HOUSE",
) {
  return call("save_house_customer", [
    id,
    "Owner's House",
    "",
    "9800000000",
    "Kathmandu",
    "Family supply",
    true,
    version,
    "Verified family approval",
    randomUUID(),
    "Owner",
    type,
    status,
  ]);
}
const items = (full = 15, empty = 10) => [
  { product_id: jar, full_jars: full, empty_jars: empty, cartons: 0 },
];
async function delivery(
  customer = house,
  status = "FREE_SUPPLY",
  lines = items(),
  received: string | null = null,
  key = randomUUID(),
) {
  return call("post_driver_delivery", [
    trip,
    customer,
    "",
    "",
    lines,
    status,
    received,
    "Isolated HOUSE test",
    key,
  ]);
}
const ops = () => call<Workspace>("operations_workspace", [trip]);
const finance = () => call<FinanceWorkspace>("finance_workspace");
async function report(
  start = "2000-01-01T00:00:00Z",
  end = "2100-01-01T00:00:00Z",
) {
  return call<HouseWorkspace>("house_workspace", [
    start,
    end,
    null,
    null,
    null,
  ]);
}
async function pricing(
  product = jar,
  eligible = true,
  ref = "50.00",
  price = "50.00",
) {
  const w = await ops(),
    p = w.products.find((p) => p.id === product)!;
  return call("save_house_pricing", [
    product,
    price,
    eligible,
    ref,
    p.version,
    "Reviewed free product pricing",
    randomUUID(),
  ]);
}
async function offlineDraft(full = 15, empty = 10): Promise<DeliveryDraft> {
  const c = await call<DeliveryCustomerContext>("delivery_customer_context", [
    trip,
    house,
  ]);
  return {
    customer: house,
    walk_name: "",
    walk_phone: "",
    items: items(full, empty),
    status: "FREE_SUPPLY",
    received: null,
    notes: "",
    total: "0.00",
    prices: [{ product_id: jar, price: "0.00" }],
    custody: [
      {
        product_id: jar,
        quantity: c.custody.find((c) => c.product_id === jar)?.quantity ?? 0,
      },
    ],
    house: {
      version: c.customer.house_version!,
      products: c
        .house_products!.filter((p) => p.id === jar)
        .map((p) => ({
          product_id: p.id,
          version: p.house_version,
          eligible: p.house_eligible,
          reference_price: p.reference_price,
        })),
    },
  };
}
async function offlinePost(
  d: DeliveryDraft,
  id = randomUUID(),
  at = new Date().toISOString(),
) {
  const payload = canonical(d);
  return call<Receipt>("offline_post", [
    trip,
    device,
    token,
    id,
    1,
    "DELIVERY",
    at,
    payload,
    createHash("sha256").update(payload).digest("hex"),
  ]);
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(
    "create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,email text);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;",
  );
  for (const file of readdirSync("supabase/migrations").sort())
    await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
  for (const id of [admin, driver, other])
    await db.query("insert into auth.users(id,email) values($1,$2)", [
      id,
      `${id}@test.example`,
    ]);
  await db.query(
    "insert into public.profiles(id,name,role,approval_status) values($1,'Admin','ADMIN','APPROVED'),($2,'Driver','DRIVER','APPROVED'),($3,'Other','DRIVER','APPROVED')",
    [admin, driver, other],
  );
  await actor(admin);
  for (const [id, sku, name, kind, price] of [
    [jar, "HOUSE20L", "20L Jar", "FULL_JAR", "50.00"],
    [carton, "HOUSECTN", "Water Carton", "BOTTLE_CARTON", "100.00"],
  ])
    await call("save_product", [
      id,
      sku,
      name,
      kind,
      "unit",
      price,
      true,
      0,
      "Isolated tests",
      randomUUID(),
    ]);
  day = await call("open_inventory_business_day", [randomUUID()]);
  for (const [id, kind, quantity] of [
    [jar, "FULL_JAR", 100],
    [carton, "BOTTLE_CARTON", 20],
  ])
    await call("adjust_warehouse_stock", [
      id,
      kind,
      quantity,
      "Isolated tests",
      "",
      day,
      randomUUID(),
    ]);
  await call("save_vehicle", [
    vehicle,
    "TEST-HOUSE",
    "",
    true,
    0,
    "Isolated tests",
    randomUUID(),
  ]);
  await houseSave("APPROVED", 0);
  await call("save_customer", [
    regular,
    "Regular Hotel",
    "",
    "",
    "",
    "",
    true,
    0,
    "Isolated tests",
    randomUUID(),
  ]);
  await call("create_trip", [trip, driver, vehicle, day, [], "", randomUUID()]);
  await call("load_trip", [
    trip,
    [
      { product_id: jar, stock_kind: "FULL_JAR", quantity: 100 },
      { product_id: carton, stock_kind: "BOTTLE_CARTON", quantity: 20 },
    ],
    randomUUID(),
  ]);
  await actor(driver);
  await call("transition_trip", [trip, "START", "", randomUUID()]);
}, 30000);
it("generic 20L jar defaults use product kind and preserve explicit admin eligibility choices", async () => {
  const defaults = new PGlite();
  try {
    await defaults.exec(
      "create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,email text);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;",
    );
    for (const file of readdirSync("supabase/migrations")
      .sort()
      .filter((f) => f < "202610130018"))
      await defaults.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
    await defaults.query(
      "insert into auth.users(id,email) values($1,'defaults@test.example');",
      [admin],
    );
    await defaults.query(
      "insert into public.profiles(id,name,role,approval_status) values($1,'Admin','ADMIN','APPROVED')",
      [admin],
    );
    await defaults.query(
      "insert into public.products(id,sku,name,kind,unit,default_price) values($1,'2','Mount Kailash Jar','FULL_JAR','JAR',50),($2,'20L','20L Jar','FULL_JAR','JAR',50),($3,'12','Carton','BOTTLE_CARTON','carton',185)",
      [jar, regular, carton],
    );
    await defaults.exec(
      readFileSync(
        "supabase/migrations/202610130018_house_free_supply.sql",
        "utf8",
      ),
    );
    await defaults.query(
      "select set_config('request.jwt.claim.sub',$1,false)",
      [admin],
    );
    await defaults.query(
      "select public.save_house_pricing($1,'50.00',false,'50.00',1,'Explicit admin exclusion',$2)",
      [regular, randomUUID()],
    );
    await defaults.query(
      "select public.save_house_pricing($1,'185.00',true,'185.00',1,'Explicit admin carton approval',$2)",
      [carton, randomUUID()],
    );
    const before = (
      await defaults.query<{ row: Record<string, unknown> }>(
        "select to_jsonb(p)-array['house_eligible','house_version'] as row from public.products p order by id",
      )
    ).rows;
    await defaults.exec(
      readFileSync(
        "supabase/migrations/202610130019_house_jar_defaults.sql",
        "utf8",
      ),
    );
    const after = (
      await defaults.query<{ row: Record<string, unknown> }>(
        "select to_jsonb(p)-array['house_eligible','house_version'] as row from public.products p order by id",
      )
    ).rows;
    expect(after).toEqual(before);
    const products = (
      await defaults.query<{ id: string; house_eligible: boolean }>(
        "select id,house_eligible from public.products",
      )
    ).rows;
    expect(products.find((p) => p.id === jar)?.house_eligible).toBe(true);
    expect(products.find((p) => p.id === regular)?.house_eligible).toBe(false);
    expect(products.find((p) => p.id === carton)?.house_eligible).toBe(true);
    const fresh = randomUUID();
    await defaults.query(
      "insert into public.products(id,sku,name,kind,unit,default_price) values($1,'JAR','Generic water jar','FULL_JAR','jar',50)",
      [fresh],
    );
    expect(
      (
        await defaults.query<{ house_eligible: boolean }>(
          "select house_eligible from public.products where id=$1",
          [fresh],
        )
      ).rows[0]?.house_eligible,
    ).toBe(true);
  } finally {
    await defaults.close();
  }
}, 30000);
beforeEach(async () => {
  await db.exec("reset role;begin");
  await actor(driver);
});
afterEach(async () => {
  await db.exec("rollback;reset role");
});
afterAll(async () => {
  await db.close();
});
it("the public regular/HOUSE lookup uses a writable PostgREST transaction and retains authenticated grants", async () => {
  const meta = (
    await db.query<{
      volatility: string;
      definer: boolean;
      permitted: boolean;
    }>(
      "select provolatile as volatility,prosecdef as definer,has_function_privilege('authenticated',oid,'EXECUTE') as permitted from pg_proc where oid='public.delivery_customer_context(uuid,uuid)'::regprocedure",
    )
  ).rows[0]!;
  expect(meta).toEqual({ volatility: "v", definer: true, permitted: true });
  expect(
    (
      await db.query<{ volatility: string }>(
          "select provolatile as volatility from pg_proc where oid='public.house_workspace(timestamptz,timestamptz,uuid,uuid,uuid)'::regprocedure",
      )
    ).rows.map((r) => r.volatility),
  ).toEqual(["v"]);
  for (const customer of [regular, house]) {
    const data = await call<DeliveryCustomerContext>(
      "delivery_customer_context",
      [trip, customer],
    );
    expect(data.customer.id).toBe(customer);
    expect(data.customer.supply_type).toBe(
      customer === house ? "HOUSE" : "REGULAR",
    );
  }
});
it("an admin can authorize one conflicted offline supply with original reference snapshots and no global approval change", async () => {
  await call("offline_register", [trip, device, token]);
  const d = await offlineDraft(),
    id = randomUUID(),
    at = new Date().toISOString();
  await actor(admin);
  await houseSave("SUSPENDED");
  await pricing(jar, false, "70.00");
  await actor(driver);
  expect((await offlinePost(d, id, at)).status).toBe("NEEDS_REVIEW");
  await denied("offline_admin_review", [
    id,
    "AUTHORIZE_HOUSE",
    null,
    "Unauthorized driver decision",
    randomUUID(),
  ]);
  await actor(admin);
  await call("offline_admin_review", [
    id,
    "AUTHORIZE_HOUSE",
    null,
    "Verified original approved family supply occurred before suspension",
    randomUUID(),
  ]);
  await actor(driver);
  expect((await offlinePost(d, id, at)).status).toBe("CONFIRMED");
  await actor(admin);
  expect((await report()).rows[0]?.reference_value).toBe("750.00");
  expect(
    (await ops()).customers.find((c) => c.id === house)?.house_status,
  ).toBe("SUSPENDED");
  expect((await finance()).credit).toHaveLength(0);
  const reviews = await call<{ reviews: { action: string }[] }>(
    "offline_admin_workspace",
  );
  expect(reviews.reviews[0]?.action).toBe("AUTHORIZE_HOUSE");
});
it("daily closing archives free supply separately and later prices do not change the archived value", async () => {
  await delivery();
  const counts = [
    { product_id: jar, stock_kind: "FULL_JAR", quantity: 85 },
    { product_id: jar, stock_kind: "EMPTY_JAR", quantity: 10 },
    { product_id: carton, stock_kind: "BOTTLE_CARTON", quantity: 20 },
  ];
  await call("submit_trip", [trip, counts, randomUUID()]);
  await actor(admin);
  await call("reconcile_trip", [
    trip,
    counts,
    "Verified physical HOUSE supply returns",
    false,
    randomUUID(),
  ]);
  await call("business_day_command", [
    "REVIEW",
    day,
    { version: 1 },
    randomUUID(),
  ]);
  await call("business_day_command", [
    "CLOSE",
    day,
    {
      version: 2,
      cash_counted: "0.00",
      cash_checked: true,
      fonepay_checked: true,
      stock_checked: true,
      balances_checked: true,
      confirmed: true,
      notes: "Verified free supply with no collected cash",
    },
    randomUUID(),
  ]);
  const first = await call<{ report: unknown }>("business_day_report", [day]);
  await pricing(jar, true, "70.00");
  const after = await call<{ report: unknown }>("business_day_report", [day]);
  expect(after.report).toEqual(first.report);
  expect(JSON.stringify(first.report)).toContain(
    '"free_supply_value":"750.00"',
  );
});
it("admin approves a HOUSE and regular customers remain regular, with 20L defaults and cartons opt-in", async () => {
  const w = await ops();
  expect(w.customers.find((c) => c.id === house)).toMatchObject({
    supply_type: "HOUSE",
    house_status: "APPROVED",
  });
  expect(w.customers.find((c) => c.id === regular)).toMatchObject({
    supply_type: "REGULAR",
    house_status: "NONE",
  });
  expect(w.products.find((p) => p.id === jar)?.house_eligible).toBe(true);
  expect(w.products.find((p) => p.id === carton)?.house_eligible).toBe(false);
});
it("15 free jars and 10 empties leave 85 full, 10 empty, 5 FIFO pending and Rs750 reference with no financial effects", async () => {
  const id = await delivery();
  await actor(admin);
  const w = await ops(),
    f = await finance(),
    r = await report(),
    loc = w.vehicles.find((v) => v.id === vehicle)!.location_id;
  expect(
    w.balances.find((b) => b.location_id === loc && b.stock_kind === "FULL_JAR")
      ?.quantity,
  ).toBe(85);
  expect(
    w.balances.find(
      (b) => b.location_id === loc && b.stock_kind === "EMPTY_JAR",
    )?.quantity,
  ).toBe(10);
  expect(w.custody.find((c) => c.customer_id === house)?.quantity).toBe(5);
  expect(f.invoices[0]?.total).toBe("0.00");
  expect(f.invoices[0]?.outstanding).toBe("0.00");
  expect(f.sales[0]?.supply_classification).toBe("FREE_SUPPLY");
  expect(f.payments).toHaveLength(0);
  expect(f.credit).toHaveLength(0);
  expect(f.ledger).toHaveLength(0);
  expect(f.issued).toHaveLength(0);
  expect(f.journal).toHaveLength(0);
  expect(f.deposits).toHaveLength(0);
  expect(r.rows[0]).toMatchObject({
    visit_id: id,
    full_jars: 15,
    empty_jars: 10,
    reference_price: "50.00",
    reference_value: "750.00",
    driver_name: "Driver",
  });
  const pending = await call<{ rows: { pending: number }[] }>(
    "pending_jar_workspace",
    [null, house],
  );
  expect(pending.rows[0]?.pending).toBe(5);
  const detail = await call<{ report: { totals: Record<string, unknown> } }>(
    "business_day_report",
    [day],
  );
  expect(detail.report.totals).toMatchObject({
    free_jars: 15,
    free_cartons: 0,
    free_supply_value: "750.00",
    sales: "0",
    collections: "0",
    new_credit: "0",
    paid_sales: "0.00",
  });
});
it("unchanged retries create exactly one stock movement set and reference snapshot", async () => {
  const key = randomUUID(),
    first = await delivery(house, "FREE_SUPPLY", items(), null, key);
  expect(await delivery(house, "FREE_SUPPLY", items(), null, key)).toBe(first);
  expect(
    (await ops()).movements.filter((m) => m.visit_id === first),
  ).toHaveLength(2);
});
it("drivers cannot approve HOUSE, configure pricing, alter raw customer privileges or read admin reports", async () => {
  await denied("save_house_customer", [
    house,
    "House",
    "",
    "",
    "",
    "",
    true,
    1,
    "Driver cannot approve",
    randomUUID(),
    "",
    "HOUSE",
    "APPROVED",
  ]);
  await denied("save_house_pricing", [
    jar,
    "0",
    true,
    "50",
    1,
    "Unauthorized change",
    randomUUID(),
  ]);
  await denied("house_workspace", [
    "2000-01-01",
    "2100-01-01",
    null,
    null,
    null,
  ]);
  await db.exec("savepoint direct");
  await expect(
    db.query(
      "update public.customers set house_status='APPROVED' where id=$1",
      [regular],
    ),
  ).rejects.toThrow(/permission/i);
  await db.exec("rollback to savepoint direct");
});
it("driver HOUSE requests stay pending and cannot authorize free delivery", async () => {
  const id = randomUUID();
  await call("request_house_contact", [
    trip,
    id,
    "Relative House",
    "",
    "9800000001",
    "",
    "0",
    false,
    randomUUID(),
    "Relative",
    "",
    "Family request",
    "HOUSE",
  ]);
  expect((await ops()).customers.find((c) => c.id === id)?.house_status).toBe(
    "PENDING",
  );
  await denied("post_driver_delivery", [
    trip,
    id,
    "",
    "",
    items(),
    "FREE_SUPPLY",
    null,
    "",
    randomUUID(),
  ]);
});
it("regular and suspended customers cannot submit free deliveries", async () => {
  await denied("post_driver_delivery", [
    trip,
    regular,
    "",
    "",
    items(),
    "FREE_SUPPLY",
    null,
    "",
    randomUUID(),
  ]);
  await actor(admin);
  await houseSave("SUSPENDED");
  await actor(driver);
  await denied("post_driver_delivery", [
    trip,
    house,
    "",
    "",
    items(),
    "FREE_SUPPLY",
    null,
    "",
    randomUUID(),
  ]);
  expect((await ops()).visits).toHaveLength(0);
});
it("mixed free jars and chargeable cartons create only carton credit and retain item classification", async () => {
  const lines = [
    ...items(),
    { product_id: carton, full_jars: 0, empty_jars: 0, cartons: 2 },
  ];
  await delivery(house, "CREDIT", lines);
  await actor(admin);
  const f = await finance();
  expect(f.invoices[0]?.total).toBe("200.00");
  expect(f.credit[0]?.outstanding).toBe("200.00");
  expect(f.sales[0]?.supply_classification).toBe("MIXED");
  expect(f.items.find((i) => i.product_id === jar)).toMatchObject({
    unit_price: "0.00",
    supply_classification: "FREE_SUPPLY",
  });
  expect(f.items.find((i) => i.product_id === carton)).toMatchObject({
    unit_price: "100.00",
    supply_classification: "SALE",
  });
  expect((await report()).rows).toHaveLength(1);
});
it("carton free eligibility is controlled by admin", async () => {
  const lines = [
    { product_id: carton, full_jars: 0, empty_jars: 0, cartons: 2 },
  ];
  await denied("post_driver_delivery", [
    trip,
    house,
    "",
    "",
    lines,
    "FREE_SUPPLY",
    null,
    "",
    randomUUID(),
  ]);
  await actor(admin);
  await pricing(carton, true, "100.00", "100.00");
  await actor(driver);
  await delivery(house, "FREE_SUPPLY", lines);
  await actor(admin);
  expect((await report()).rows[0]?.reference_value).toBe("200.00");
  expect((await finance()).credit).toHaveLength(0);
});
it("regular Paid/Credit and customer-specific prices continue unchanged", async () => {
  await actor(admin);
  await call("finance_command", [
    "PRICE",
    {
      customer: regular,
      product: jar,
      price: "40.00",
      active: true,
      version: 0,
      reason: "Negotiated regular price",
    },
    randomUUID(),
  ]);
  await actor(driver);
  await delivery(regular, "PAID", items(2, 0), "80.00");
  await delivery(regular, "CREDIT", items(1, 0));
  await actor(admin);
  const f = await finance();
  expect(f.payments[0]?.amount).toBe("80.00");
  expect(f.credit[0]?.outstanding).toBe("40.00");
  expect((await report()).rows).toHaveLength(0);
});
it("later pricing and approval changes preserve historical snapshots and deliveries", async () => {
  await delivery();
  await actor(admin);
  await pricing(jar, true, "70.00", "60.00");
  await houseSave("SUSPENDED");
  expect((await report()).rows[0]).toMatchObject({
    reference_price: "50.00",
    reference_value: "750.00",
  });
});
it("empty-only HOUSE returns use FIFO without sale/invoice/payment or new free value", async () => {
  await delivery();
  await delivery(house, "RETURN_ONLY", items(0, 5));
  await actor(admin);
  const f = await finance();
  expect(f.invoices).toHaveLength(1);
  expect((await ops()).custody[0]?.quantity).toBe(0);
  expect((await report()).rows).toHaveLength(1);
  const c = await call<DeliveryCustomerContext>("delivery_customer_context", [
    trip,
    house,
  ]);
  expect(c.pending_jars).toHaveLength(0);
  expect(c.jar_allocations?.reduce((n, a) => n + a.quantity, 0)).toBe(15);
});
it("fully free delivery rejects money, and alternate visit APIs cannot spoof zero prices", async () => {
  await denied("post_driver_delivery", [
    trip,
    house,
    "",
    "",
    items(),
    "FREE_SUPPLY",
    "1.00",
    "",
    randomUUID(),
  ]);
  await denied("post_trip_visit", [
    trip,
    house,
    "",
    "",
    items(),
    {
      selection: "CASH",
      payments: [
        {
          method: "CASH",
          amount: "1",
          current_amount: "1",
          deposit_amount: "0",
          allocations: [],
        },
      ],
    },
    "",
    randomUUID(),
  ]);
  await call("post_trip_visit", [
    trip,
    regular,
    "",
    "",
    [{ ...items(1, 0)[0], unit_price_snapshot: 0 }],
    { selection: "UNPAID" },
    "",
    randomUUID(),
  ]);
  await actor(admin);
  expect((await finance()).invoices[0]?.total).toBe("50.00");
});
it("offline approved HOUSE sync is exactly once and preserves original occurrence date", async () => {
  await call("offline_register", [trip, device, token]);
  const d = await offlineDraft(),
    id = randomUUID(),
    at = new Date(Date.now() - 60000).toISOString();
  const r = await offlinePost(d, id, at);
  expect(r.status).toBe("CONFIRMED");
  expect(await offlinePost(d, id, at)).toEqual(r);
  await actor(admin);
  const w = await ops();
  expect(w.movements.filter((m) => m.visit_id === r.result)).toHaveLength(2);
  expect((await report()).rows[0]?.reference_value).toBe("750.00");
  const c = await call<DeliveryCustomerContext>("delivery_customer_context", [
    trip,
    house,
  ]);
  expect(new Date(c.pending_jars![0]!.original_date).toISOString()).toBe(at);
});
it("suspension while offline keeps evidence for admin review without financial or stock effects", async () => {
  await call("offline_register", [trip, device, token]);
  const d = await offlineDraft();
  await actor(admin);
  await houseSave("SUSPENDED");
  await actor(driver);
  const r = await offlinePost(d);
  expect(r.status).toBe("NEEDS_REVIEW");
  expect(r.message).toMatch(/approval changed/i);
  await actor(admin);
  expect((await report()).rows).toHaveLength(0);
  expect((await finance()).invoices).toHaveLength(0);
  expect((await ops()).visits).toHaveLength(0);
  const review = await call<{ operations: { payload: string }[] }>(
    "offline_admin_workspace",
  );
  expect(review.operations[0]?.payload).toBe(canonical(d));
});
it("product eligibility and reference changes while offline require explicit review", async () => {
  await call("offline_register", [trip, device, token]);
  const d = await offlineDraft();
  await actor(admin);
  await pricing(jar, false, "70.00");
  await actor(driver);
  const r = await offlinePost(d);
  expect(r.status).toBe("NEEDS_REVIEW");
  expect(r.message).toMatch(/eligibility or reference/i);
  expect((await ops()).visits).toHaveLength(0);
});
it("offline HOUSE requests stay pending with no implicit approval", async () => {
  await call("offline_register", [trip, device, token]);
  const j = {
      id: randomUUID(),
      name: "Offline relative",
      shop_name: "",
      phone: "",
      address: "",
      version: 0,
      supply_type: "HOUSE",
    },
    payload = canonical(j);
  const r = await call<Receipt>("offline_post", [
    trip,
    device,
    token,
    randomUUID(),
    1,
    "CUSTOMER",
    new Date().toISOString(),
    payload,
    createHash("sha256").update(payload).digest("hex"),
  ]);
  expect(r.status).toBe("CONFIRMED");
  expect(
    (await ops()).customers.find((c) => c.id === r.customer)?.house_status,
  ).toBe("PENDING");
});
it("report dates use Nepal occurrence time, including offline supply and customer/product filters", async () => {
  const id = await delivery();
  await actor(admin);
  expect((await report("2000-01-01", "2001-01-01")).rows).toHaveLength(0);
  const r = await call<HouseWorkspace>("house_workspace", [
    "2000-01-01",
    "2100-01-01",
    house,
    driver,
    jar,
  ]);
  expect(r.rows[0]?.visit_id).toBe(id);
  expect(
    (
      await call<HouseWorkspace>("house_workspace", [
        "2000-01-01",
        "2100-01-01",
        regular,
        driver,
        jar,
      ])
    ).rows,
  ).toHaveLength(0);
});
it("audited reference adjustments cannot mutate original snapshots or create revenue/debt", async () => {
  const id = await delivery();
  await actor(admin);
  await call("adjust_free_supply", [
    id,
    day,
    "50.00",
    "DECREASE",
    "Verified reference correction",
    randomUUID(),
  ]);
  expect((await report()).rows[0]?.reference_value).toBe("750.00");
  expect((await report()).adjustments[0]?.amount).toBe("-50.00");
  expect((await finance()).journal).toHaveLength(0);
  await db.exec("reset role;savepoint immutable");
  await expect(
    db.exec("update public.free_supply_adjustments set amount=100"),
  ).rejects.toThrow(/immutable/i);
  await db.exec("rollback to savepoint immutable");
});
