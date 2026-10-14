import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID, createHash } from "node:crypto";
import { beforeAll, afterAll, beforeEach, afterEach, it, expect } from "vitest";
import { canonical } from "@/domain/offline/operations";
import type { Receipt } from "@/domain/offline/types";
const admin = randomUUID(),
  driver = randomUUID(),
  other = randomUUID(),
  jar = randomUUID(),
  vehicle = randomUUID(),
  customer = randomUUID(),
  trip = randomUUID(),
  device = randomUUID(),
  token = "a".repeat(64);
let db: PGlite, day: string;
async function actor(id: string | null, role = "authenticated") {
  await db.exec(`reset role;set role ${role}`);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    id ?? "",
  ]);
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
  pattern = /authorized|device|registered|permission|checkpoint|access/i,
) {
  await db.exec("savepoint forbidden");
  await expect(call(name, args)).rejects.toThrow(pattern);
  await db.exec("rollback to savepoint forbidden");
}
function draft(full = 20, empty = 15, balance = 0) {
  return {
    customer,
    walk_name: "",
    walk_phone: "",
    items: [
      { product_id: jar, full_jars: full, empty_jars: empty, cartons: 0 },
    ],
    status: "PAID",
    received: `${full * 10}.00`,
    total: `${full * 10}.00`,
    notes: "",
    prices: [{ product_id: jar, price: "10.00" }],
    custody: [{ product_id: jar, quantity: balance }],
  };
}
async function post(
  sequence: number,
  kind: string,
  payload: unknown,
  id = randomUUID(),
  occurred = new Date().toISOString(),
) {
  const text = canonical(payload);
  return call<Receipt>("offline_post", [
    trip,
    device,
    token,
    id,
    sequence,
    kind,
    occurred,
    text,
    createHash("sha256").update(text).digest("hex"),
  ]);
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(
    "create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,email text);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;",
  );
  for (const f of readdirSync("supabase/migrations").sort())
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
  await actor(admin);
  await call("save_product", [
    jar,
    "OFFLINEJAR",
    "20L",
    "FULL_JAR",
    "jar",
    "10.00",
    true,
    0,
    "Isolated tests",
    randomUUID(),
  ]);
  day = await call("open_inventory_business_day", [randomUUID()]);
  await call("adjust_warehouse_stock", [
    jar,
    "FULL_JAR",
    100,
    "Isolated tests",
    "",
    day,
    randomUUID(),
  ]);
  await call("save_vehicle", [
    vehicle,
    "TEST-OFFLINE",
    "",
    true,
    0,
    "Isolated tests",
    randomUUID(),
  ]);
  await call("save_customer", [
    customer,
    "Offline hotel",
    "",
    "98123",
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
    [{ product_id: jar, stock_kind: "FULL_JAR", quantity: 100 }],
    randomUUID(),
  ]);
  await actor(driver);
  await call("transition_trip", [trip, "START", "", randomUUID()]);
  await call("offline_register", [trip, device, token]);
}, 30000);
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await db.exec("reset role;begin");
  await actor(driver);
});
afterEach(async () => {
  await db.exec("rollback;reset role");
});
it("trusts one approved device, registers idempotently and preserves the recovery envelope", async () => {
  const box = "encrypted-recovery-envelope".repeat(3);
  expect(
    await call("trusted_device_register", [device, token, "Driver phone", box]),
  ).toMatchObject({ registered: true, device });
  await call("trusted_device_register", [
    device,
    token,
    "Driver phone",
    "replacement-ciphertext".repeat(3),
  ]);
  expect(await call("trusted_device_recovery", [device])).toBe(box);
  await denied(
    "trusted_device_register",
    [randomUUID(), "b".repeat(64), "Second phone", box],
    /one trusted device/i,
  );
  await denied(
    "offline_register",
    [trip, randomUUID(), "b".repeat(64)],
    /approved trusted device/i,
  );
});
it("RLS hides device keys and another driver's device; only admin can see the directory", async () => {
  await call("trusted_device_register", [
    device,
    token,
    "Phone",
    "encrypted-recovery".repeat(3),
  ]);
  await actor(other);
  expect(
    (await db.query("select device_id from public.driver_trusted_devices"))
      .rows,
  ).toHaveLength(0);
  await denied("trusted_device_recovery", [device], /unavailable/);
  await denied(
    "trusted_device_revoke",
    [device, "Unauthorized removal"],
    /authorized/,
  );
  await denied("trusted_device_directory", [], /Admin access/);
  await actor(admin);
  const directory = await call<Record<string, unknown>[]>(
    "trusted_device_directory",
  );
  expect(directory[0]).toMatchObject({ device_id: device });
  expect(directory[0]).not.toHaveProperty("recovery_box");
  expect(directory[0]).not.toHaveProperty("token_hash");
  await db.exec("savepoint secret_columns");
  await expect(
    db.query(
      "select token_hash,recovery_box from public.driver_trusted_devices",
    ),
  ).rejects.toThrow(/permission/);
  await db.exec("rollback to savepoint secret_columns");
});
it("admin revocation prevents uploads and recovery without deleting sale evidence", async () => {
  await call("trusted_device_register", [
    device,
    token,
    "Phone",
    "encrypted-recovery".repeat(3),
  ]);
  await post(1, "DELIVERY", draft());
  await actor(admin);
  await call("trusted_device_revoke", [
    device,
    "Phone lost; preserve evidence",
  ]);
  await actor(driver);
  await denied("offline_checkin", [trip, device, token, 1], /revoked/);
  await denied("trusted_device_recovery", [device], /unavailable/);
  await denied(
    "trusted_device_register",
    [device, token, "Phone", "encrypted-recovery".repeat(3)],
    /revoked/,
  );
  await actor(admin);
  expect(
    (
      await db.query(
        "select id from public.driver_offline_operations where trip_id=$1",
        [trip],
      )
    ).rows,
  ).toHaveLength(1);
});
it("driver cannot remove a device with an active unsealed round", async () => {
  await call("trusted_device_register", [
    device,
    token,
    "Phone",
    "encrypted-recovery".repeat(3),
  ]);
  await denied(
    "trusted_device_revoke",
    [device, "Remove phone"],
    /Sync and seal/,
  );
});
it("a device check-in is not reported as a confirmed synchronization", async () => {
  await call("trusted_device_register", [
    device,
    token,
    "Phone",
    "encrypted-recovery".repeat(3),
  ]);
  await call("offline_checkin", [trip, device, token, 1]);
  expect(
    (
      await db.query<{ last_synced_at: string | null }>(
        "select last_synced_at from public.driver_trusted_devices where device_id=$1",
        [device],
      )
    ).rows[0]?.last_synced_at,
  ).toBeNull();
  const receipt = await post(1, "DELIVERY", draft());
  expect(receipt.status).toBe("CONFIRMED");
  const row = (
    await db.query<{ last_synced_at: Date }>(
      "select last_synced_at from public.driver_trusted_devices where device_id=$1",
      [device],
    )
  ).rows[0]!;
  expect(new Date(row.last_synced_at).toISOString()).toBe(
    new Date(receipt.processedAt).toISOString(),
  );
});
it("suspension prevents trusted registration and recovery", async () => {
  await call("trusted_device_register", [
    device,
    token,
    "Phone",
    "encrypted-recovery".repeat(3),
  ]);
  await db.exec("reset role");
  await db.query(
    "update public.profiles set approval_status='SUSPENDED',is_active=false where id=$1",
    [driver],
  );
  await actor(driver);
  await denied("trusted_device_register", [
    device,
    token,
    "Phone",
    "encrypted-recovery".repeat(3),
  ]);
  await denied("trusted_device_recovery", [device]);
});
it("posts exactly once with atomic paid, inventory and custody effects and immutable ACK", async () => {
  const id = randomUUID(),
    at = new Date().toISOString(),
    payload = draft(35, 30);
  const first = await post(1, "DELIVERY", payload, id, at);
  expect(first.status).toBe("CONFIRMED");
  expect(await post(1, "DELIVERY", payload, id, at)).toEqual(first);
  await actor(admin);
  const w = await call<{
    items: { full_jars: number; empty_jars: number }[];
    balances: { location_id: string; stock_kind: string; quantity: number }[];
    vehicles: { id: string; location_id: string }[];
  }>("operations_workspace", [trip]);
  expect(w.items).toHaveLength(1);
  const loc = w.vehicles.find((v) => v.id === vehicle)!.location_id;
  expect(
    w.balances.find((b) => b.location_id === loc && b.stock_kind === "FULL_JAR")
      ?.quantity,
  ).toBe(65);
  expect(
    w.balances.find(
      (b) => b.location_id === loc && b.stock_kind === "EMPTY_JAR",
    )?.quantity,
  ).toBe(30);
  const f = await call<{ payments: unknown[]; invoices: unknown[] }>(
    "finance_workspace",
  );
  expect(f.payments).toHaveLength(1);
  expect(f.invoices).toHaveLength(1);
  await db.exec("reset role");
  await expect(
    db.query(
      "update public.driver_offline_operations set message='changed' where id=$1",
      [id],
    ),
  ).rejects.toThrow(/immutable/);
});
it("preserves evidence when the same ID has changed contents without extra effects", async () => {
  const id = randomUUID(),
    at = new Date().toISOString();
  expect((await post(1, "DELIVERY", draft(), id, at)).status).toBe("CONFIRMED");
  expect((await post(1, "DELIVERY", draft(21, 15), id, at)).status).toBe(
    "NEEDS_REVIEW",
  );
  await actor(admin);
  expect(
    (await call<{ reviews: unknown[] }>("offline_admin_workspace")).reviews,
  ).toHaveLength(1);
});
it("rolls back every business effect on wrong payment or negative stock and retains failed operation", async () => {
  expect(
    (await post(1, "DELIVERY", { ...draft(), received: "199.00" })).status,
  ).toBe("NEEDS_REVIEW");
  await actor(admin);
  expect(
    (
      await call<{ visits: unknown[]; items: unknown[] }>(
        "operations_workspace",
        [trip],
      )
    ).visits,
  ).toHaveLength(0);
  expect(
    (await call<{ invoices: unknown[] }>("finance_workspace")).invoices,
  ).toHaveLength(0);
});
it("binds one writer and blocks legacy bypasses, private helpers, another driver and suspended sessions", async () => {
  await denied("offline_register", [trip, randomUUID(), "b".repeat(64)]);
  await denied("post_driver_delivery", [
    trip,
    customer,
    "",
    "",
    draft().items,
    "PAID",
    "200.00",
    "",
    randomUUID(),
  ]);
  await denied("offline_hash", [token]);
  await actor(other);
  await denied("offline_register", [trip, device, token]);
  await actor(admin);
  await call("change_driver_status", [
    driver,
    "SUSPENDED",
    1,
    "Isolated suspension",
    randomUUID(),
  ]);
  await actor(driver);
  await denied("offline_post", [
    trip,
    device,
    token,
    randomUUID(),
    1,
    "DELIVERY",
    new Date().toISOString(),
    canonical(draft()),
    createHash("sha256").update(canonical(draft())).digest("hex"),
  ]);
});
it("creates customers before dependent credit sales and preserves both local relationships", async () => {
  const id = randomUUID();
  const c = await post(1, "CUSTOMER", {
    id,
    name: "New hotel",
    shop_name: "",
    phone: "98777",
    address: "",
    version: 0,
  });
  expect(c.status).toBe("CONFIRMED");
  expect(c.customer).toBe(id);
  expect(
    (
      await post(2, "DELIVERY", {
        ...draft(),
        customer: id,
        status: "CREDIT",
        received: null,
      })
    ).status,
  ).toBe("CONFIRMED");
  await actor(admin);
  const f = await call<{
    credit: { customer_id: string; outstanding: string }[];
    payments: unknown[];
  }>("finance_workspace");
  expect(f.credit.find((c) => c.customer_id === id)?.outstanding).toBe(
    "200.00",
  );
  expect(f.payments).toHaveLength(0);
});
it("detects duplicate customers for audited matching rather than overwriting them", async () => {
  const id = randomUUID(),
    op = randomUUID(),
    at = new Date().toISOString(),
    c = {
      id,
      name: "Offline hotel",
      shop_name: "",
      phone: "98123",
      address: "",
      version: 0,
    };
  expect((await post(1, "CUSTOMER", c, op, at)).status).toBe("NEEDS_REVIEW");
  await actor(admin);
  await call("offline_admin_review", [
    op,
    "MATCH_CUSTOMER",
    customer,
    "Confirmed existing identity",
    randomUUID(),
  ]);
  await actor(driver);
  const retry = await post(1, "CUSTOMER", c, op, at);
  expect(retry.status).toBe("CONFIRMED");
  expect(retry.customer).toBe(customer);
  expect((await post(2, "DELIVERY", { ...draft(), customer: id })).status).toBe(
    "CONFIRMED",
  );
});
it("detects changed jar balances and preserves original occurrence dates in FIFO lots", async () => {
  const at = new Date(Date.now() - 60000).toISOString();
  const first = await post(1, "DELIVERY", draft(), randomUUID(), at);
  expect(first.status).toBe("CONFIRMED");
  const lots = await call<{
    rows: { original_date: string; pending: number }[];
  }>("pending_jar_workspace", [trip, customer]);
  expect(new Date(lots.rows[0]!.original_date).toISOString()).toBe(at);
  expect(lots.rows[0]!.pending).toBe(5);
  expect((await post(2, "DELIVERY", draft(10, 12, 0))).status).toBe(
    "NEEDS_REVIEW",
  );
});
it("requires the exact device manifest, seals return checkpoint and reconciles 100/80/65 to 20/65", async () => {
  const visit = await post(1, "DELIVERY", draft(80, 65));
  expect(visit.status).toBe("CONFIRMED");
  const counts = [
    { product_id: jar, stock_kind: "FULL_JAR", quantity: 20 },
    { product_id: jar, stock_kind: "EMPTY_JAR", quantity: 65 },
  ];
  await denied("submit_trip", [trip, counts, randomUUID()]);
  await actor(admin);
  const blockers = await call<{ blockers: { code: string }[] }>(
    "business_day_report",
    [day],
  );
  expect(JSON.stringify(blockers)).toContain("OFFLINE_SYNC");
  await actor(driver);
  const submit = await post(2, "SUBMIT", {
    counts,
    manifest: [{ id: visit.id, fingerprint: visit.fingerprint }],
  });
  expect(submit.status).toBe("CONFIRMED");
  const server = await call<{
    round: { phase: string; checkpoint_at: string };
  }>("offline_read_state", [trip, device, token]);
  expect(server.round.phase).toBe("SEALED");
  expect(server.round.checkpoint_at).toBeTruthy();
  await actor(admin);
  await call("reconcile_trip", [
    trip,
    counts,
    "Counted physical return",
    false,
    randomUUID(),
  ]);
  expect(
    (
      await call<{ trips: { status: string }[] }>("operations_workspace", [
        trip,
      ])
    ).trips[0]!.status,
  ).toBe("CLOSED");
});
it("records an admin missing-device exception without fabricating unsent transactions", async () => {
  await actor(admin);
  const counts = [
    { product_id: jar, stock_kind: "FULL_JAR", quantity: 100 },
    { product_id: jar, stock_kind: "EMPTY_JAR", quantity: 0 },
  ];
  await call("offline_admin_exception", [
    trip,
    counts,
    "Phone missing; physically counted stock and reviewed recorded collections",
    randomUUID(),
  ]);
  expect(
    (await call<{ reviews: { action: string }[] }>("offline_admin_workspace"))
      .reviews[0]!.action,
  ).toBe("MISSING_DEVICE_EXCEPTION");
  await call("reconcile_trip", [
    trip,
    counts,
    "Physical inventory checked",
    false,
    randomUUID(),
  ]);
});
it("keeps FIFO original dates across repeated visits and an empty-only collection", async () => {
  const firstAt = new Date(Date.now() - 50000).toISOString(),
    secondAt = new Date(Date.now() - 10000).toISOString();
  expect(
    (await post(1, "DELIVERY", draft(20, 15, 0), randomUUID(), firstAt)).status,
  ).toBe("CONFIRMED");
  expect(
    (await post(2, "DELIVERY", draft(10, 12, 5), randomUUID(), secondAt))
      .status,
  ).toBe("CONFIRMED");
  const pending = await call<{
    rows: { pending: number; original_date: string }[];
    allocations: { original_date: string }[];
  }>("pending_jar_workspace", [trip, customer]);
  expect(pending.rows).toHaveLength(1);
  expect(pending.rows[0]!.pending).toBe(3);
  expect(new Date(pending.rows[0]!.original_date).toISOString()).toBe(secondAt);
  expect(
    (
      await post(3, "DELIVERY", {
        ...draft(0, 3, 3),
        status: "RETURN_ONLY",
        received: null,
      })
    ).status,
  ).toBe("CONFIRMED");
  await actor(admin);
  expect(
    (await call<{ invoices: unknown[] }>("finance_workspace")).invoices,
  ).toHaveLength(2);
});
it("supports exactly-once prior-credit cash collection and preserves genuine pending Fonepay", async () => {
  expect(
    (
      await post(1, "DELIVERY", {
        ...draft(),
        status: "CREDIT",
        received: null,
      })
    ).status,
  ).toBe("CONFIRMED");
  await actor(admin);
  const f = await call<{ credit: { id: string; outstanding: string }[] }>(
    "finance_workspace",
  );
  await actor(driver);
  const payment = {
    customer,
    method: "CASH",
    amount: "50.00",
    current_amount: "0.00",
    deposit_amount: "0.00",
    reference: "",
    allocations: [{ invoice_id: f.credit[0]!.id, amount: "50.00" }],
  };
  const id = randomUUID(),
    at = new Date().toISOString();
  expect((await post(2, "PAYMENT", payment, id, at)).status).toBe("CONFIRMED");
  expect((await post(2, "PAYMENT", payment, id, at)).status).toBe("CONFIRMED");
  expect(
    (
      await post(3, "PAYMENT", {
        ...payment,
        method: "FONEPAY",
        reference: "ISOLATED-ONLY",
      })
    ).status,
  ).toBe("CONFIRMED");
  await actor(admin);
  const after = await call<{
    credit: { outstanding: string; available: string }[];
    payments: { status: string }[];
  }>("finance_workspace");
  expect(after.credit[0]!.outstanding).toBe("150.00");
  expect(after.credit[0]!.available).toBe("100.00");
  expect(after.payments).toHaveLength(2);
  expect(after.payments.filter((p) => p.status === "PENDING")).toHaveLength(1);
});
it("rejects negative stock and changed price with no financial or inventory effects", async () => {
  expect((await post(1, "DELIVERY", draft(101, 0))).status).toBe(
    "NEEDS_REVIEW",
  );
  await actor(admin);
  expect(
    (await call<{ items: unknown[] }>("operations_workspace", [trip])).items,
  ).toHaveLength(0);
});
it("detects a changed negotiated price instead of silently discarding payment differences", async () => {
  await actor(admin);
  await call("finance_command", [
    "PRICE",
    {
      customer,
      product: jar,
      version: 0,
      price: "11.00",
      active: true,
      reason: "Isolated pricing update",
    },
    randomUUID(),
  ]);
  await actor(driver);
  const receipt = await post(1, "DELIVERY", draft());
  expect(receipt.status).toBe("NEEDS_REVIEW");
  expect(receipt.message).toMatch(/pricing changed/);
  await actor(admin);
  expect(
    (await call<{ invoices: unknown[] }>("finance_workspace")).invoices,
  ).toHaveLength(0);
});
it("audits explicit custody rebase while preserving the driver's original evidence", async () => {
  expect((await post(1, "DELIVERY", draft())).status).toBe("CONFIRMED");
  const id = randomUUID(),
    at = new Date().toISOString(),
    original = draft(10, 12, 0);
  expect((await post(2, "DELIVERY", original, id, at)).status).toBe(
    "NEEDS_REVIEW",
  );
  await actor(admin);
  await call("offline_admin_review", [
    id,
    "REBASE_CUSTODY",
    null,
    "Checked prior returns against current customer ledger",
    randomUUID(),
  ]);
  await actor(driver);
  expect((await post(2, "DELIVERY", original, id, at)).status).toBe(
    "CONFIRMED",
  );
  await actor(admin);
  expect(
    (
      await call<{ rows: { pending: number }[] }>("pending_jar_workspace", [
        trip,
        customer,
      ])
    ).rows[0]!.pending,
  ).toBe(3);
  await db.exec("reset role");
  expect(
    (
      await db.query<{ payload: string }>(
        "select payload from public.driver_offline_operations where id=$1",
        [id],
      )
    ).rows[0]!.payload,
  ).toBe(canonical(original));
});
it("holds stale customer edits for review rather than overwriting current contact versions", async () => {
  const receipt = await post(1, "CONTACT", {
    id: customer,
    name: "Old edit",
    shop_name: "",
    phone: "",
    address: "",
    version: 0,
  });
  expect(receipt.status).toBe("NEEDS_REVIEW");
  expect(receipt.message).toMatch(/Customer changed/);
  await actor(admin);
  expect(
    (
      await call<{ customers: { id: string; name: string }[] }>(
        "operations_workspace",
        [trip],
      )
    ).customers.find((c) => c.id === customer)!.name,
  ).toBe("Offline hotel");
});
it("blocks direct evidence writes, other-driver data and admin recovery under driver RLS", async () => {
  await denied("offline_admin_workspace", []);
  await denied("offline_admin_exception", [
    trip,
    [],
    "Forged review",
    randomUUID(),
  ]);
  await db.exec("savepoint raw");
  await expect(
    db.query("select token_hash from public.driver_offline_rounds"),
  ).rejects.toThrow(/permission/);
  await db.exec("rollback to savepoint raw");
  await actor(other);
  expect(
    (await db.query("select trip_id from public.driver_offline_rounds")).rows,
  ).toHaveLength(0);
  expect(
    (await db.query("select id from public.driver_offline_operations")).rows,
  ).toHaveLength(0);
});
it("requires a real device manifest and holds late records outside an open day", async () => {
  const r = await post(1, "DELIVERY", draft());
  expect(r.status).toBe("CONFIRMED");
  expect(
    (
      await post(2, "SUBMIT", {
        counts: [
          { product_id: jar, stock_kind: "FULL_JAR", quantity: 80 },
          { product_id: jar, stock_kind: "EMPTY_JAR", quantity: 15 },
        ],
        manifest: [],
      })
    ).status,
  ).toBe("NEEDS_REVIEW");
  await actor(admin);
  // Closing review itself is gated by unresolved stock/trips/offline records.
  await denied(
    "business_day_command",
    ["REVIEW", day, { version: 1 }, randomUUID()],
    /block|trip|checkpoint|resolve|unresolved/i,
  );
  const report = await call<{ blockers: unknown[] }>("business_day_report", [
    day,
  ]);
  expect(JSON.stringify(report.blockers)).toContain("OFFLINE_SYNC");
});
