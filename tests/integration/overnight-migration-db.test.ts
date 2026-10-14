import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { it, expect } from "vitest";
import type { DayDetail } from "@/domain/business-days/types";

it("the overnight migration preserves a confirmed historical trip, all original ledgers and its closing archive", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema auth to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;`);
    const migration = "202610130023_overnight_trip_loading.sql";
    for (const f of readdirSync("supabase/migrations")
      .sort()
      .filter((f) => f < migration))
      await db.exec(readFileSync(`supabase/migrations/${f}`, "utf8"));
    const admin = randomUUID(),
      driver = randomUUID(),
      product = randomUUID(),
      vehicle = randomUUID(),
      customer = randomUUID(),
      trip = randomUUID();
    for (const [id, role] of [
      [admin, "ADMIN"],
      [driver, "DRIVER"],
    ]) {
      await db.query("insert into auth.users values($1)", [id]);
      await db.query(
        "insert into public.profiles(id,name,role,approval_status) values($1,'Historical fixture',$2,'APPROVED')",
        [id, role],
      );
    }
    const actor = async (id: string) => {
      await db.exec("reset role;set role authenticated");
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
        id,
      ]);
    };
    const rpc = async <T = string>(name: string, args: unknown[]) =>
      (
        await db.query<{ value: T }>(
          `select public.${name}(${args.map((_, i) => `$${i + 1}`).join(",")}) as value`,
          args,
        )
      ).rows[0]!.value;
    await actor(admin);
    await rpc("save_product", [
      product,
      "HISTORY-JAR",
      "Historical jar",
      "FULL_JAR",
      "jar",
      "100",
      true,
      0,
      "Isolated migration fixture",
      randomUUID(),
    ]);
    const day = await rpc("open_inventory_business_day", [randomUUID()]);
    await rpc("adjust_warehouse_stock", [
      product,
      "FULL_JAR",
      10,
      "Historical opening",
      "",
      day,
      randomUUID(),
    ]);
    await rpc("save_vehicle", [
      vehicle,
      "HISTORY-VEHICLE",
      "",
      true,
      0,
      "Isolated migration fixture",
      randomUUID(),
    ]);
    await rpc("save_customer", [
      customer,
      "Historical customer",
      "",
      "",
      "",
      "",
      true,
      0,
      "Isolated migration fixture",
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
    await rpc("load_trip", [
      trip,
      JSON.stringify([
        { product_id: product, stock_kind: "FULL_JAR", quantity: 10 },
      ]),
      randomUUID(),
    ]);
    await actor(driver);
    await rpc("transition_trip", [trip, "START", "", randomUUID()]);
    await rpc("post_driver_delivery", [
      trip,
      customer,
      "",
      "",
      JSON.stringify([
        { product_id: product, full_jars: 2, empty_jars: 1, cartons: 0 },
      ]),
      "CREDIT",
      null,
      "",
      randomUUID(),
    ]);
    const counts = JSON.stringify([
      { product_id: product, stock_kind: "FULL_JAR", quantity: 8 },
      { product_id: product, stock_kind: "EMPTY_JAR", quantity: 1 },
    ]);
    await rpc("submit_trip", [trip, counts, randomUUID()]);
    await actor(admin);
    await rpc("reconcile_trip", [
      trip,
      counts,
      "Physically verified historical return",
      false,
      randomUUID(),
    ]);
    const detail = await rpc<DayDetail>("business_day_report", [day]);
    expect(detail.blockers).toEqual([]);
    const version = detail.report.day.version;
    await rpc("business_day_command", [
      "REVIEW",
      day,
      JSON.stringify({ version }),
      randomUUID(),
    ]);
    await rpc("business_day_command", [
      "CLOSE",
      day,
      JSON.stringify({
        version: version + 1,
        cash_counted: "0",
        notes: "Historical verified closing",
        cash_checked: true,
        fonepay_checked: true,
        stock_checked: true,
        balances_checked: true,
        confirmed: true,
      }),
      randomUUID(),
    ]);
    const archive = (await rpc<DayDetail>("business_day_report", [day])).report;
    expect(archive.source).toBe("ARCHIVED");
    // An older confirmed load may still be retried after the migration.
    const preparedDay = await rpc("open_inventory_business_day", [
      randomUUID(),
    ]);
    const preparedTrip = randomUUID(),
      loadingKey = randomUUID();
    const preparedItems = JSON.stringify([
      { product_id: product, stock_kind: "FULL_JAR", quantity: 2 },
    ]);
    await rpc("create_trip", [
      preparedTrip,
      driver,
      vehicle,
      preparedDay,
      "[]",
      "Legacy prepared trip",
      randomUUID(),
    ]);
    await rpc("load_trip", [preparedTrip, preparedItems, loadingKey]);
    await db.exec("reset role");
    const tables = [
      "stock_movements",
      "inventory_balances",
      "trips",
      "trip_load_items",
      "trip_return_checks",
      "trip_return_check_items",
      "trip_visits",
      "visit_items",
      "sales",
      "invoices",
      "payments",
      "customer_ledger",
      "jar_custody_entries",
      "jar_custody_balances",
      "business_days",
      "business_day_closings",
    ];
    const snapshot = async () => {
      const records: unknown[] = [];
      for (const table of tables) {
        const query =
          table === "trips"
            ? "to_jsonb(t)-array['scheduled_date','created_business_day_id','loaded_at','loaded_by','loading_business_day_id','cancelled']"
            : "to_jsonb(t)";
        records.push(
          (
            await db.query<{ v: unknown }>(
              `select coalesce(jsonb_agg(${query} order by (${query})::text),'[]'::jsonb) v from public.${table} t`,
            )
          ).rows[0]!.v,
        );
      }
      return records;
    };
    const before = await snapshot();
    await db.exec(readFileSync(`supabase/migrations/${migration}`, "utf8"));
    expect(await snapshot()).toEqual(before);
    const metadata = (
      await db.query<Record<string, unknown>>(
        "select status,scheduled_date::text,created_business_day_id,loaded_at,loaded_by,loading_business_day_id,cancelled from public.trips where id=$1",
        [trip],
      )
    ).rows[0]!;
    expect(metadata).toMatchObject({
      status: "CLOSED",
      scheduled_date: archive.day.date_label,
      created_business_day_id: day,
      loaded_at: null,
      loaded_by: null,
      loading_business_day_id: null,
      cancelled: false,
    });
    await actor(admin);
    await rpc("load_trip", [preparedTrip, preparedItems, loadingKey]);
    await db.exec("reset role");
    expect(await snapshot()).toEqual(before);
    expect(
      (
        await db.query<{
          loaded_at: null;
          loaded_by: null;
          loading_business_day_id: null;
        }>(
          "select loaded_at,loaded_by,loading_business_day_id from public.trips where id=$1",
          [preparedTrip],
        )
      ).rows[0],
    ).toEqual({
      loaded_at: null,
      loaded_by: null,
      loading_business_day_id: null,
    });
    await actor(admin);
    expect((await rpc<DayDetail>("business_day_report", [day])).report).toEqual(
      archive,
    );
    // Bypass table privileges to exercise the re-enabled historical guard itself.
    await db.exec("reset role");
    await expect(
      db.query("update public.trips set notes='rewrite' where id=$1", [trip]),
    ).rejects.toThrow(/Closed trips are immutable/);
  } finally {
    await db.close();
  }
}, 30000);
