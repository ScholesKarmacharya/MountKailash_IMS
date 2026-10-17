// Test-only provider adapter. Real application RPCs/RLS run against ephemeral PostgreSQL.
// Binds loopback only; no Cloud client, environment credentials or production data.
import { createServer } from "node:http";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
const ids = {
  admin: "00000000-0000-0000-0000-000000000001",
  driver: "00000000-0000-0000-0000-000000000002",
  other: "00000000-0000-0000-0000-000000000003",
  pending: "00000000-0000-0000-0000-000000000004",
  jar: "00000000-0000-0000-0000-000000000011",
  carton: "00000000-0000-0000-0000-000000000012",
};
let db;
let logoutFailures = 0;
const preferences = new Map();
const providerPort =
  process.env.VERIFY_DRIVER_E2E === "1"
    ? 17779
    : process.env.OFFLINE_E2E === "1"
      ? 17778
      : 17777;
async function reset() {
  logoutFailures = 0;
  preferences.clear();
  await db?.close();
  db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,email text);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;`);
  for (const file of readdirSync("supabase/migrations").sort())
    await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
  await db.query(
    "insert into auth.users(id,email) values($1,$2),($3,$4),($5,$6),($7,$8)",
    [
      ids.admin,
      "admin@fixture.example",
      ids.driver,
      "driver@fixture.example",
      ids.other,
      "other@fixture.example",
      ids.pending,
      "pending@fixture.example",
    ],
  );
  await db.query(
    "insert into public.profiles(id,name,role,approval_status) values($1,'Fixture admin', 'ADMIN','APPROVED'),($2,'Fixture driver', 'DRIVER','APPROVED'),($3,'Other driver', 'DRIVER','APPROVED')",
    [ids.admin, ids.driver, ids.other],
  );
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    ids.admin,
  ]);
  for (const [id, sku, name, kind] of [
    [ids.jar, "JAR", "20L test jar", "FULL_JAR"],
    [ids.carton, "CARTON", "Test water carton", "BOTTLE_CARTON"],
  ])
    await db.query(
      "select public.save_product($1,$2,$3,$4,'unit','150.25',true,0,'Ephemeral browser test',gen_random_uuid())",
      [id, sku, name, kind],
    );
  const day = (
    await db.query(
      "select public.open_inventory_business_day(gen_random_uuid()) as id",
    )
  ).rows[0].id;
  for (const [id, kind, count] of [
    [ids.jar, "FULL_JAR", 100],
    [ids.carton, "BOTTLE_CARTON", 10],
  ])
    await db.query(
      "select public.adjust_warehouse_stock($1,$2,$3,'Ephemeral browser test','',$4,gen_random_uuid())",
      [id, kind, count, day],
    );
}
function user(id) {
  return {
    id,
    aud: "authenticated",
    role: "authenticated",
    email: Object.keys(ids).find((k) => ids[k] === id) + "@fixture.example",
    app_metadata: { provider: "email" },
    user_metadata: preferences.get(id) ?? {},
    created_at: new Date().toISOString(),
  };
}
function session(id) {
  const b = (v) => Buffer.from(JSON.stringify(v)).toString("base64url");
  return {
    access_token: `${b({ alg: "HS256", typ: "JWT" })}.${b({ sub: id, exp: Math.floor(Date.now() / 1000) + 3600, role: "authenticated", aud: "authenticated" })}.fixture`,
    token_type: "bearer",
    expires_in: 3600,
    refresh_token: `fixture-${id}`,
    user: user(id),
  };
}
function tokenId(req) {
  try {
    const token = (req.headers.authorization ?? "").replace(/^Bearer /, "");
    const claims = JSON.parse(
      Buffer.from(token.split(".")[1], "base64url").toString(),
    );
    if (claims.exp <= Math.floor(Date.now() / 1000)) return null;
    const id = claims.sub;
    return [ids.admin, ids.driver, ids.other, ids.pending].includes(id)
      ? id
      : null;
  } catch {
    return null;
  }
}
const allowedTables = new Set([
  "profiles",
  "products",
  "visit_items",
  "stock_locations",
  "inventory_balances",
  "business_days",
  "stock_adjustments",
  "stock_movements",
  "warehouse_processing",
  "trips",
  "trip_load_items",
  "audit_events",
  "customer_ledger",
  "driver_offline_rounds",
]);
const allowedRpc = new Set([
  "offline_ownership_diagnostics",
  "offline_preparation_access",
  "offline_admin_reset_device",
  "admin_driver_offline_access",
  "offline_admin_reset_access",
  "offline_device_journal",
  "post_instant_delivery",
  "convert_instant_customer",
  "instant_workspace",
  "instant_history",
  "notification_feed",
  "notification_read",
  "trusted_device_register",
  "trusted_device_recovery",
  "trusted_device_revoke",
  "trusted_device_directory",
  "offline_register",
  "offline_read_state",
  "offline_contexts",
  "offline_checkin",
  "offline_post",
  "offline_admin_workspace",
  "offline_admin_review",
  "offline_admin_exception",
  "save_own_profile",
  "save_driver_account",
  "change_driver_status",
  "admin_driver_directory",
  "save_delivery_customer",
  "save_delivery_contact",
  "delivery_customer_context",
  "delivery_customer_directory",
  "pending_jar_workspace",
  "admin_jar_workspace",
  "admin_jar_history",
  "pending_jar_directory",
  "operations_workspace",
  "finance_workspace",
  "finance_command",
  "business_day_history",
  "business_day_report",
  "business_day_command",
  "process_warehouse_jars",
  "finance_credit",
  "customer_delivery_history",
  "save_customer",
  "save_house_customer",
  "request_house_contact",
  "save_house_pricing",
  "adjust_free_supply",
  "house_workspace",
  "save_vehicle",
  "save_driver",
  "create_trip",
  "schedule_trip",
  "create_trip_with_load",
  "save_trip_draft_load",
  "trip_preparation_command",
  "assign_trip_customer",
  "load_trip",
  "transition_trip",
  "post_trip_visit",
  "post_driver_delivery",
  "submit_trip",
  "reconcile_trip",
  "adjust_customer_custody",
  "adjust_warehouse_stock",
  "save_product",
  "open_inventory_business_day",
]);
async function handle(req, res) {
  const url = new URL(req.url, `http://127.0.0.1:${providerPort}`);
  const reply = (status, data) => {
    res.writeHead(status, {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
    });
    res.end(JSON.stringify(data));
  };
  if (req.method === "GET" && url.pathname === "/health")
    return reply(200, { ready: true });
  if (req.method === "POST" && url.pathname === "/reset") {
    await reset();
    return reply(200, { ready: true });
  }
  // Advance only the disposable test database's scheduling clock. This endpoint
  // exists only in this loopback provider; production routes never expose it.
  if (req.method === "POST" && url.pathname === "/next-business-date") {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const { date, day } = JSON.parse(Buffer.concat(chunks).toString());
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^[a-f0-9-]{36}$/.test(day))
      return reply(400, {});
    await db.exec("reset role");
    await db.query(
      "update public.business_days set date_label=$1 where id=$2 and status='OPEN'",
      [date, day],
    );
    await db.exec(
      `create or replace function public.trip_nepal_date() returns date language sql volatile set search_path='' as $$select '${date}'::date$$`,
    );
    return reply(200, { ready: true });
  }
  if (req.method === "POST" && url.pathname === "/logout-failure") {
    logoutFailures = 1;
    return reply(200, { ready: true });
  }
  let body = {};
  if (req.method === "POST" || req.method === "PUT") {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
  }
  if (url.pathname === "/auth/v1/token") {
    if (url.searchParams.get("grant_type") === "refresh_token") {
      const id = String(body.refresh_token ?? "").replace(/^fixture-/, "");
      if (![ids.admin, ids.driver, ids.other, ids.pending].includes(id))
        return reply(400, {
          error_code: "refresh_token_not_found",
          message: "Invalid refresh token",
        });
      return reply(200, session(id));
    }
    const key = String(body.email ?? "").split("@")[0];
    if (
      !["admin", "driver", "other", "pending"].includes(key) ||
      body.password !== "fixture-password"
    )
      return reply(400, { message: "Invalid fixture credentials" });
    return reply(200, session(ids[key]));
  }
  const actor = tokenId(req);
  if (url.pathname === "/auth/v1/user" && req.method === "PUT" && actor) {
    if (!["en", "ne"].includes(body.data?.locale))
      return reply(400, { message: "Invalid fixture locale" });
    preferences.set(actor, { locale: body.data.locale });
    return reply(200, user(actor));
  }
  if (url.pathname === "/auth/v1/user")
    return actor
      ? reply(200, user(actor))
      : reply(401, { message: "Missing fixture session" });
  if (url.pathname === "/auth/v1/logout") {
    if (logoutFailures > 0) {
      logoutFailures--;
      return reply(503, { message: "Simulated fixture outage" });
    }
    return reply(200, {});
  }
  if (!actor) return reply(401, { message: "Unauthorized fixture request" });
  await db.exec("begin; set local role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [actor]);
  try {
    let result;
    if (url.pathname.startsWith("/rest/v1/rpc/")) {
      const name = url.pathname.split("/").at(-1);
      if (!allowedRpc.has(name)) throw new Error("Unknown fixture RPC");
      const volatility = (
        await db.query(
          "select provolatile from pg_proc where pronamespace='public'::regnamespace and proname=$1 order by oid desc limit 1",
          [name],
        )
      ).rows[0]?.provolatile;
      // Match PostgREST POST transaction access mode. A plain SQL SELECT in a
      // writable test transaction hid the live STABLE/FOR SHARE regression.
      if (volatility !== "v") await db.exec("set transaction read only");
      const entries = Object.entries(body);
      if (entries.some(([k]) => !/^p_[a-z_]+$/.test(k)))
        throw new Error("Invalid fixture arguments");
      const args = entries.map(([k, v]) =>
        name === "notification_read" && k === "p_ids"
          ? v
          : typeof v === "object" && v !== null
            ? JSON.stringify(v)
            : v,
      );
      result = (
        await db.query(
          `select public.${name}(${entries.map(([k], i) => `${k}=>$${i + 1}`).join(",")}) as value`,
          args,
        )
      ).rows[0].value;
    } else {
      const table = url.pathname.split("/").at(-1);
      if (!allowedTables.has(table)) throw new Error("Unknown fixture table");
      {
        const alias =
          {
            trips: "t",
            stock_movements: "m",
            stock_adjustments: "a",
            warehouse_processing: "w",
            audit_events: "e",
          }[table] ?? table;
        const columnFor = (key) => {
          if (
            key === "business_days.date_label" &&
            ["trips", "warehouse_processing"].includes(table)
          )
            return "d.date_label";
          if (
            table === "stock_adjustments" &&
            [
              "stock_movements.product_id",
              "stock_movements.stock_kind",
            ].includes(key)
          )
            return "m." + key.split(".")[1];
          if (!/^[a-z_]+$/.test(key)) throw new Error("Invalid fixture column");
          return alias + "." + key;
        };
        const filters = [],
          args = [];
        for (const [key, value] of url.searchParams) {
          if (["select", "order", "limit", "offset"].includes(key)) continue;
          if (key === "or") {
            const terms = value
              .slice(1, -1)
              .split(",")
              .map((term) => {
                const match = /^([a-z_]+)\.eq\.(.+)$/.exec(term);
                if (!match) throw new Error("Unsupported fixture OR filter");
                args.push(match[2]);
                return `${columnFor(match[1])}=$${args.length}`;
              });
            filters.push("(" + terms.join(" or ") + ")");
            continue;
          }
          const column = columnFor(key);
          if (value.startsWith("eq.")) {
            args.push(value.slice(3));
            filters.push(`${column}=$${args.length}`);
          } else if (value.startsWith("neq.")) {
            args.push(value.slice(4));
            filters.push(`${column}<>$${args.length}`);
          } else if (/^(gte|lte|gt|lt)\./.test(value)) {
            const [operator, ...rest] = value.split(".");
            args.push(rest.join("."));
            const symbol = { gte: ">=", lte: "<=", gt: ">", lt: "<" }[operator];
            filters.push(`${column}${symbol}$${args.length}`);
          } else if (value.startsWith("in.(")) {
            const vals = value.slice(4, -1).split(",");
            const placeholders = vals.map((v) => {
              args.push(v);
              return `$${args.length}`;
            });
            filters.push(`${column} in (${placeholders.join(",")})`);
          } else throw new Error("Unsupported fixture filter");
        }
        const ordering = (url.searchParams.get("order") ?? "")
          .split(",")
          .filter(Boolean)
          .map((part) => {
            const match =
              /^([a-z_]+)\.(asc|desc)(?:\.nulls(first|last))?$/.exec(part);
            if (!match) throw new Error("Invalid fixture ordering");
            return `${alias}.${match[1]} ${match[2]}${match[3] ? ` nulls ${match[3]}` : ""}`;
          });
        result = (
          await db.query(
            (table === "stock_movements"
              ? "select m.*,jsonb_build_object('name',p.name,'sku',p.sku,'unit',p.unit) as product,jsonb_build_object('name',a.name) as actor,case when f.id is null then null else jsonb_build_object('name',f.name,'kind',f.kind,'code',f.code) end as from_location,case when dest.id is null then null else jsonb_build_object('name',dest.name,'kind',dest.kind,'code',dest.code) end as to_location,jsonb_build_object('date_label',d.date_label) as business_day,case when t.id is null then null else jsonb_build_object('trip_number',t.trip_number) end as trip,case when w.id is null then null else jsonb_build_object('reason',w.reason,'operation',w.operation) end as processing from public.stock_movements m join public.products p on p.id=m.product_id join public.profiles a on a.id=m.actor_user_id join public.business_days d on d.id=m.business_day_id left join public.stock_locations f on f.id=m.from_location_id left join public.stock_locations dest on dest.id=m.to_location_id left join public.trips t on t.id=m.trip_id left join public.warehouse_processing w on w.id=m.processing_id"
              : table === "stock_adjustments"
                ? "select a.*,to_jsonb(m)||jsonb_build_object('profiles',jsonb_build_object('name',p.name),'business_days',jsonb_build_object('date_label',d.date_label)) as stock_movements from public.stock_adjustments a join public.stock_movements m on m.id=a.stock_movement_id join public.profiles p on p.id=m.actor_user_id join public.business_days d on d.id=m.business_day_id"
                : table === "warehouse_processing"
                  ? "select w.*,jsonb_build_object('name',p.name,'unit',p.unit) as product,jsonb_build_object('name',a.name) as actor,jsonb_build_object('date_label',d.date_label) as business_days,coalesce((select jsonb_agg(to_jsonb(m) order by m.line_number) from public.stock_movements m where m.processing_id=w.id),'[]'::jsonb) as movements from public.warehouse_processing w join public.products p on p.id=w.product_id join public.profiles a on a.id=w.actor_user_id join public.business_days d on d.id=w.business_day_id"
                  : table === "trips"
                    ? "select t.*,json_build_object('plate_number',v.plate_number) as vehicles,json_build_object('name',p.name) as profiles,json_build_object('date_label',d.date_label) as business_days from public.trips t join public.vehicles v on v.id=t.vehicle_id join public.profiles p on p.id=t.driver_id join public.business_days d on d.id=t.business_day_id"
                    : table === "audit_events"
                      ? "select e.*,jsonb_build_object('name',p.name) as actor from public.audit_events e join public.profiles p on p.id=e.actor_user_id"
                      : table === "driver_offline_rounds"
                        ? "select trip_id,phase from public.driver_offline_rounds"
                        : `select * from public.${table}`) +
              (filters.length ? " where " + filters.join(" and ") : "") +
              (ordering.length ? " order by " + ordering.join(",") : ""),
            args,
          )
        ).rows;
        const offset = Number(url.searchParams.get("offset") ?? 0),
          limit = Number(url.searchParams.get("limit") ?? result.length);
        result = result.slice(offset, offset + limit);
        if (
          (req.headers.accept ?? "").includes(
            "application/vnd.pgrst.object+json",
          )
        )
          result = result[0] ?? null;
      }
    }
    await db.exec("commit");
    return reply(200, result);
  } catch (error) {
    await db.exec("rollback");
    return reply(error.code === "25006" ? 405 : 400, {
      code: error.code ?? "TEST",
      message: error.message,
    });
  }
}
await reset();
let queue = Promise.resolve();
createServer((req, res) => {
  queue = queue
    .then(() => handle(req, res))
    .catch(() => {
      res.writeHead(500);
      res.end('{"message":"Isolated fixture error"}');
    });
}).listen(providerPort, "127.0.0.1", () =>
  console.log("Ephemeral PostgreSQL test provider ready on loopback."),
);
