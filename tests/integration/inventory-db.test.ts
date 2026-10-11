import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import {
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  describe,
  it,
  expect,
} from "vitest";
const admin = "00000000-0000-0000-0000-000000000001";
const driver = "00000000-0000-0000-0000-000000000002";
const disabled = "00000000-0000-0000-0000-000000000003";
const jar = "00000000-0000-0000-0000-000000000011";
const carton = "00000000-0000-0000-0000-000000000012";
let db: PGlite;
let day: string;
async function identity(id: string | null, role = "authenticated") {
  await db.exec(`reset role; set role ${role};`);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    id ?? "",
  ]);
}
async function product(
  id = jar,
  kind = "FULL_JAR",
  key = randomUUID(),
  version = 0,
  price = "150.25",
  active = true,
) {
  return db.query<{ id: string }>(
    "select public.save_product($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) as id",
    [
      id,
      id === jar ? "JAR20" : "CARTON",
      id === jar ? "20L water jar" : "Water carton",
      kind,
      "unit",
      price,
      active,
      version,
      "Test catalog setup",
      key,
    ],
  );
}
async function adjust(
  delta = 10,
  key = randomUUID(),
  kind = "FULL_JAR",
  productId = jar,
  dayId = day,
  reason = "Opening count",
) {
  return db.query<{ id: string }>(
    "select public.adjust_warehouse_stock($1,$2,$3,$4,$5,$6,$7) as id",
    [productId, kind, delta, reason, "Test notes", dayId, key],
  );
}
async function quantity() {
  return (
    await db.query<{ quantity: number }>(
      "select quantity from public.inventory_balances where product_id=$1 and stock_kind='FULL_JAR'",
      [jar],
    )
  ).rows[0]!.quantity;
}
describe("Sprint 1 real PostgreSQL migrations, RPCs and RLS (isolated PGlite)", () => {
  beforeAll(async () => {
    db = new PGlite();
    // Provider-owned identities and auth.uid() are stubbed; all application SQL is unmodified.
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create schema auth; create table auth.users(id uuid primary key,email text);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;
    `);
    await db.exec(
      readFileSync("supabase/migrations/202610110001_sprint0.sql", "utf8"),
    );
    await db.exec(
      readFileSync(
        "supabase/migrations/202610110002_sprint1_inventory.sql",
        "utf8",
      ),
    );
    await db.query("insert into auth.users(id) values ($1),($2),($3)", [
      admin,
      driver,
      disabled,
    ]);
    await db.query(
      "insert into public.profiles(id,name,role,is_active) values ($1,'TEST admin','ADMIN',true),($2,'TEST driver','DRIVER',true),($3,'TEST disabled','ADMIN',false)",
      [admin, driver, disabled],
    );
  }, 30000);
  afterAll(async () => {
    await db.close();
  });
  beforeEach(async () => {
    await db.exec("begin");
    await identity(admin);
    await product();
    await product(carton, "BOTTLE_CARTON");
    day = (
      await db.query<{ id: string }>(
        "select public.open_inventory_business_day($1) as id",
        [randomUUID()],
      )
    ).rows[0]!.id;
  });
  afterEach(async () => {
    await db.exec("rollback; reset role;");
  });
  // Savepoint keeps failed-statement tests inside the same rollback-only fixture.
  async function denied(operation: () => Promise<unknown>, message: RegExp) {
    await db.exec("savepoint negative_test");
    await expect(operation()).rejects.toThrow(message);
    await db.exec("rollback to savepoint negative_test");
  }
  it("creates zero stock, distinct full/empty jar states and exact NUMERIC price", async () => {
    expect(await quantity()).toBe(0);
    expect(
      (await db.query("select * from public.inventory_balances")).rows,
    ).toHaveLength(3);
    expect(
      (
        await db.query<{ price: string }>(
          "select default_price::text as price from public.products where id=$1",
          [jar],
        )
      ).rows[0]!.price,
    ).toBe("150.25");
  });
  it("posts balance, movement, adjustment and audit atomically", async () => {
    await adjust(10);
    await adjust(-3);
    expect(await quantity()).toBe(7);
    expect(
      (await db.query("select * from public.stock_movements")).rows,
    ).toHaveLength(2);
    const entries = await db.query<{
      quantity_before: number;
      quantity_after: number;
      reason: string;
    }>("select * from public.stock_adjustments order by quantity_before");
    expect(
      entries.rows.map((row) => [row.quantity_before, row.quantity_after]),
    ).toEqual([
      [0, 10],
      [10, 7],
    ]);
    expect(
      (
        await db.query(
          "select * from public.audit_events where action='STOCK_ADJUSTED'",
        )
      ).rows,
    ).toHaveLength(2);
  });
  it("identical retry returns same entry without double stock", async () => {
    const key = randomUUID();
    const first = await adjust(10, key);
    const second = await adjust(10, key);
    expect(second.rows).toEqual(first.rows);
    expect(await quantity()).toBe(10);
    expect(
      (await db.query("select * from public.stock_movements")).rows,
    ).toHaveLength(1);
  });
  it("key reuse with altered payload is rejected", async () => {
    const key = randomUUID();
    await adjust(10, key);
    await denied(() => adjust(11, key), /different request/);
    expect(await quantity()).toBe(10);
  });
  it("idempotency is scoped by actor across operation types", async () => {
    const key = randomUUID();
    await adjust(2, key);
    await denied(() => product(jar, "FULL_JAR", key, 1), /different request/);
    expect(await quantity()).toBe(2);
  });
  it("stock integer overflow is rejected without partial movement", async () => {
    await adjust(1000000000);
    await adjust(1000000000);
    await denied(() => adjust(200000000), /supported range/);
    expect(await quantity()).toBe(2000000000);
  });
  it("negative stock rejection leaves no partial journal or request", async () => {
    const key = randomUUID();
    await denied(() => adjust(-1, key), /Insufficient stock/);
    expect(await quantity()).toBe(0);
    expect(
      (await db.query("select * from public.stock_movements")).rows,
    ).toHaveLength(0);
    await adjust(2, key);
    expect(await quantity()).toBe(2);
  });
  it("failure after balance write rolls back the entire RPC", async () => {
    await db.exec(
      "reset role; create function public.test_audit_failure() returns trigger language plpgsql as $$ begin raise exception 'Injected audit failure'; end $$; create trigger test_failure before insert on public.audit_events for each row execute function public.test_audit_failure();",
    );
    await identity(admin);
    await denied(() => adjust(5), /Injected audit failure/);
    expect(await quantity()).toBe(0);
    expect(
      (await db.query("select * from public.stock_movements")).rows,
    ).toHaveLength(0);
  });
  it("validates state, reason, quantity and money at the database boundary", async () => {
    await denied(
      () => adjust(1, randomUUID(), "EMPTY_JAR", carton),
      /does not match/,
    );
    await denied(
      () => adjust(1, randomUUID(), "FULL_JAR", jar, day, " "),
      /Invalid adjustment/,
    );
    await denied(() => adjust(0), /Invalid adjustment/);
    await denied(() => adjust(1000000001), /Invalid adjustment/);
    await denied(
      () => product(jar, "FULL_JAR", randomUUID(), 1, "10.123"),
      /Invalid product/,
    );
  });
  it("blocks closed or review days and uses explicit day across midnight", async () => {
    await db.exec("reset role;");
    await db.query(
      "update public.business_days set date_label='2020-01-01' where id=$1",
      [day],
    );
    await identity(admin);
    await adjust(1);
    expect(
      (
        await db.query<{ id: string }>(
          "select business_day_id as id from public.stock_movements",
        )
      ).rows[0]!.id,
    ).toBe(day);
    await db.exec("reset role;");
    await db.query(
      "update public.business_days set status='CLOSING_REVIEW' where id=$1",
      [day],
    );
    await identity(admin);
    await denied(() => adjust(1), /OPEN business day/);
    await db.exec("reset role;");
    await db.query(
      "update public.business_days set status='CLOSED',closed_at=now(),closed_by=$2 where id=$1",
      [day, admin],
    );
    await identity(admin);
    await denied(() => adjust(1), /OPEN business day/);
  });
  it("day opening is retry-safe and stock carries into another day", async () => {
    await adjust(8);
    await db.exec("reset role;");
    await db.query(
      "update public.business_days set status='CLOSED',closed_at=now(),closed_by=$2 where id=$1",
      [day, admin],
    );
    await identity(admin);
    const key = randomUUID();
    const first = await db.query(
      "select public.open_inventory_business_day($1)",
      [key],
    );
    expect(
      (await db.query("select public.open_inventory_business_day($1)", [key]))
        .rows,
    ).toEqual(first.rows);
    expect(await quantity()).toBe(8);
    await denied(
      () =>
        db.query("select public.open_inventory_business_day($1)", [
          randomUUID(),
        ]),
      /already active/,
    );
    expect(
      (
        await db.query<{ label: string; today: string }>(
          "select date_label::text as label,(now() at time zone 'Asia/Kathmandu')::date::text as today from public.business_days where status='OPEN'",
        )
      ).rows.every((row) => row.label === row.today),
    ).toBe(true);
  });
  it("updates products with optimistic version, preserves kind/stock/history and deactivation", async () => {
    await adjust(4);
    const key = randomUUID();
    await product(jar, "FULL_JAR", key, 1, "180.50", false);
    await product(jar, "FULL_JAR", key, 1, "180.50", false);
    await denied(
      () => product(jar, "FULL_JAR", randomUUID(), 1),
      /Product changed/,
    );
    await denied(
      () => product(jar, "BOTTLE_CARTON", randomUUID(), 2),
      /kind cannot change/,
    );
    expect(await quantity()).toBe(4);
    await adjust(-1);
    expect(await quantity()).toBe(3);
    expect(
      (
        await db.query<{ is_active: boolean; version: number }>(
          "select * from public.products where id=$1",
          [jar],
        )
      ).rows[0],
    ).toMatchObject({ is_active: false, version: 2 });
  });
  it("driver cannot read warehouse/catalog/audit or call any write RPC", async () => {
    await identity(driver);
    for (const table of [
      "products",
      "stock_locations",
      "inventory_balances",
      "stock_movements",
      "stock_adjustments",
      "audit_events",
    ])
      expect(
        (await db.query(`select * from public.${table}`)).rows,
      ).toHaveLength(0);
    await denied(() => adjust(), /Active admin required/);
    await denied(() => product(), /Active admin required/);
    await denied(
      () =>
        db.query("select public.open_inventory_business_day($1)", [
          randomUUID(),
        ]),
      /Active admin required/,
    );
    await denied(
      () => db.exec("update public.inventory_balances set quantity=100"),
      /permission denied/,
    );
  });
  it("disabled admin and missing identity cannot write", async () => {
    for (const id of [disabled, null]) {
      await identity(id);
      await denied(() => adjust(), /Active admin required/);
      expect(
        (await db.query("select * from public.products")).rows,
      ).toHaveLength(0);
    }
  });
  it("anonymous caller cannot invoke RPC", async () => {
    await identity(null, "anon");
    await denied(() => adjust(), /permission denied/);
  });
  it("even admin cannot directly edit balances, products or journals", async () => {
    await adjust();
    for (const table of [
      "products",
      "inventory_balances",
      "stock_movements",
      "stock_adjustments",
      "audit_events",
    ])
      await denied(
        () => db.exec(`delete from public.${table}`),
        /permission denied/,
      );
    await denied(
      () => db.exec("update public.inventory_balances set quantity=999"),
      /permission denied/,
    );
  });
  it("journal mutation triggers also block privileged changes", async () => {
    await adjust();
    await db.exec("reset role;");
    for (const table of [
      "stock_movements",
      "stock_adjustments",
      "audit_events",
      "operation_requests",
    ])
      await denied(() => db.exec(`delete from public.${table}`), /immutable/);
    await denied(
      () => db.exec("truncate public.stock_movements cascade"),
      /immutable/,
    );
  });
});
