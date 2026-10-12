// Test-only provider adapter. Real application RPCs/RLS run against ephemeral PostgreSQL.
// Binds loopback only; no Cloud client, environment credentials or production data.
import { createServer } from "node:http";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
const ids = {
  admin: "00000000-0000-0000-0000-000000000001",
  driver: "00000000-0000-0000-0000-000000000002",
  other: "00000000-0000-0000-0000-000000000003",
  jar: "00000000-0000-0000-0000-000000000011",
  carton: "00000000-0000-0000-0000-000000000012",
};
let db;
const preferences = new Map();
async function reset() {
  preferences.clear();
  await db?.close();
  db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,email text);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;`);
  for (const file of readdirSync("supabase/migrations").sort())
    await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
  await db.query(
    "insert into auth.users(id,email) values($1,$2),($3,$4),($5,$6)",
    [
      ids.admin,
      "admin@fixture.example",
      ids.driver,
      "driver@fixture.example",
      ids.other,
      "other@fixture.example",
    ],
  );
  await db.query(
    "insert into public.profiles(id,name,role) values($1,'Fixture admin','ADMIN'),($2,'Fixture driver','DRIVER'),($3,'Other driver','DRIVER')",
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
    refresh_token: "fixture-only",
    user: user(id),
  };
}
function tokenId(req) {
  try {
    const token = (req.headers.authorization ?? "").replace(/^Bearer /, "");
    const id = JSON.parse(
      Buffer.from(token.split(".")[1], "base64url").toString(),
    ).sub;
    return [ids.admin, ids.driver, ids.other].includes(id) ? id : null;
  } catch {
    return null;
  }
}
const allowedTables = new Set([
  "profiles",
  "products",
  "stock_locations",
  "inventory_balances",
  "business_days",
  "stock_adjustments",
  "stock_movements",
  "trips",
  "customer_ledger",
]);
const allowedRpc = new Set([
  "save_delivery_customer",
  "save_delivery_contact",
  "delivery_customer_context",
  "delivery_customer_directory",
  "pending_jar_workspace",
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
  "save_vehicle",
  "save_driver",
  "create_trip",
  "assign_trip_customer",
  "load_trip",
  "transition_trip",
  "post_trip_visit",
  "submit_trip",
  "reconcile_trip",
  "adjust_customer_custody",
  "adjust_warehouse_stock",
  "save_product",
  "open_inventory_business_day",
]);
async function handle(req, res) {
  const url = new URL(req.url, "http://127.0.0.1:17777");
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
  let body = {};
  if (req.method === "POST" || req.method === "PUT") {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
  }
  if (url.pathname === "/auth/v1/token") {
    const key = String(body.email ?? "").split("@")[0];
    if (
      !["admin", "driver", "other"].includes(key) ||
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
  if (url.pathname === "/auth/v1/logout") return reply(200, {});
  if (!actor) return reply(401, { message: "Unauthorized fixture request" });
  await db.exec("begin; set local role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [actor]);
  try {
    let result;
    if (url.pathname.startsWith("/rest/v1/rpc/")) {
      const name = url.pathname.split("/").at(-1);
      if (!allowedRpc.has(name)) throw new Error("Unknown fixture RPC");
      const entries = Object.entries(body);
      if (entries.some(([k]) => !/^p_[a-z_]+$/.test(k)))
        throw new Error("Invalid fixture arguments");
      const args = entries.map(([, v]) =>
        typeof v === "object" && v !== null ? JSON.stringify(v) : v,
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
      if (table === "stock_adjustments") {
        result = [];
      } else {
        const filters = [],
          args = [];
        for (const [key, value] of url.searchParams) {
          if (["select", "order", "limit", "offset"].includes(key)) continue;
          const column =
            table === "trips" && key === "business_days.date_label"
              ? "d.date_label"
              : key;
          if (!/^[a-z_]+$/.test(key) && column !== "d.date_label")
            throw new Error("Invalid fixture column");
          if (value.startsWith("eq.")) {
            args.push(value.slice(3));
            filters.push(`${column}=$${args.length}`);
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
            filters.push(`${key} in (${placeholders.join(",")})`);
          } else throw new Error("Unsupported fixture filter");
        }
        result = (
          await db.query(
            (table === "trips"
              ? "select t.*,json_build_object('plate_number',v.plate_number) as vehicles,json_build_object('name',p.name) as profiles,json_build_object('date_label',d.date_label) as business_days from public.trips t join public.vehicles v on v.id=t.vehicle_id join public.profiles p on p.id=t.driver_id join public.business_days d on d.id=t.business_day_id"
              : `select * from public.${table}`) +
              (filters.length ? " where " + filters.join(" and ") : ""),
            args,
          )
        ).rows;
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
    return reply(400, { code: error.code ?? "TEST", message: error.message });
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
}).listen(17777, "127.0.0.1", () =>
  console.log("Ephemeral PostgreSQL test provider ready on loopback."),
);
