import { it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { dayCommand, dateFilter } from "@/domain/business-days/commands";
import { dailyCsv, dailyDocument } from "@/domain/business-days/reports";
import type { DayReport } from "@/domain/business-days/types";
function form(operation = "CLOSE") {
  const f = new FormData();
  Object.entries({
    operation: `day:${operation}`,
    day: randomUUID(),
    key: randomUUID(),
    version: "2",
    cash_counted: "-50.25",
    notes: "Signed cash after refund recorded",
    cash_checked: "on",
    fonepay_checked: "on",
    stock_checked: "on",
    balances_checked: "on",
    confirmed: "on",
    actor: "forged",
    role: "ADMIN",
    totals: '{"sales":"0"}',
  }).forEach(([k, v]) => f.set(k, v));
  return f;
}
it("closing whitelists request data, owns identity and requires all explicit confirmations", () => {
  const f = form(),
    c = dayCommand(f);
  expect(c.admin).toBe(true);
  expect(c.rpc).toBe("business_day_command");
  expect(c.args.p_data).toMatchObject({
    cash_counted: "-50.25",
    confirmed: true,
  });
  expect(c.args.p_data).not.toHaveProperty("actor");
  expect(c.args.p_data).not.toHaveProperty("totals");
  for (const field of [
    "cash_checked",
    "fonepay_checked",
    "stock_checked",
    "balances_checked",
    "confirmed",
  ]) {
    const missing = form();
    missing.delete(field);
    expect(() => dayCommand(missing)).toThrow(/Confirm/);
  }
});
it("invalid cash precision, missing evidence and unknown operations are rejected", () => {
  const f = form();
  f.set("cash_counted", "1.001");
  expect(() => dayCommand(f)).toThrow(/decimals/);
  f.set("cash_counted", "0");
  f.set("notes", "");
  expect(() => dayCommand(f)).toThrow(/evidence/);
  expect(() => dayCommand(form("RESET"))).toThrow(/Unknown/);
});
it("refill quantities must be positive integers and cannot refill full jars", () => {
  const f = form("REFILL");
  f.set("product", randomUUID());
  f.set("stock_kind", "EMPTY_JAR");
  f.set("quantity", "65");
  f.set("reason", "Completed refill");
  expect(dayCommand(f).args.p_quantity).toBe(65);
  for (const q of ["0", "1.5", "-1", "1000000001"]) {
    f.set("quantity", q);
    expect(() => dayCommand(f)).toThrow();
  }
  f.set("quantity", "1");
  f.set("stock_kind", "FULL_JAR");
  expect(() => dayCommand(f)).toThrow();
});
it("business date filters validate calendar dates rather than timestamps or normalized invalid dates", () => {
  expect(dateFilter("2026-10-11")).toBe("2026-10-11");
  expect(dateFilter(undefined)).toBeNull();
  expect(dateFilter("")).toBeNull();
  for (const d of [
    "2026-02-30",
    "2026-13-01",
    "2026-10-11T22:00:00Z",
    ["2026-10-11"],
    null,
  ])
    expect(() => dateFilter(d)).toThrow();
});
it("CSV protects formula-bearing names while preserving exact negative monetary numbers and UTF-8", () => {
  const report = {
    schema_version: 1,
    source: "ARCHIVED",
    day: {
      id: randomUUID(),
      date_label: "2026-10-11",
      status: "CLOSED",
      opened_at: "2026-10-11T01:15:00Z",
      opened_by: randomUUID(),
      opened_by_name: "=HYPERLINK(1)",
      closed_at: "2026-10-11T19:00:00Z",
      closed_by: randomUUID(),
      closed_by_name: "Admin",
      version: 3,
    },
    company: { name: "Mount Kailash" },
    totals: {
      sales: "-50.25",
      gross_sales: "-50.25",
      tax: "0",
      collections: "0",
      cash: "0",
      fonepay: "0",
      pending_fonepay: "0",
      cash_net: "-50.25",
      new_credit: "0",
      old_credit_recovered: "0",
      outstanding: "0",
      deposits_received: "0",
      deposits_refunded: "50.25",
      deposits_reversed: "0",
      deposit_liability: "0",
      trips: 0,
      completed_trips: 0,
      pending_trips: 0,
      full_jars: 0,
      empty_jars: 0,
      cartons: 0,
      refilled: 0,
      damaged: 0,
    },
    stock: [],
    trips: [],
    products: [],
    customers: [],
    payments: [],
    journal: [],
    events: [],
    deposits: [],
    processing: [],
    movements: [],
    adjustments: [],
    invoice_adjustments: [],
    discrepancies: [],
    custody: [],
    credit: [
      {
        customer_id: "customer",
        name: '=HYPERLINK("bad")',
        outstanding: "-50.25",
      },
      { customer_id: "customer2", name: "माउन्ट कैलाश", outstanding: "0" },
    ],
    deposit_balances: [],
    pending_jars: [
      {
        entry_id: "lot",
        customer_id: "customer",
        customer_name: "Hotel",
        product_name: "20L jar",
        pending: 3,
        original_date: "2026-10-10T10:00:00Z",
        driver_name: "Delivery staff",
        trip_number: 7,
        source: "Delivery",
      },
    ],
  } as unknown as DayReport;
  const csv = dailyCsv(report);
  expect(csv.startsWith("\ufeff")).toBe(true);
  expect(csv).toContain('"\'=HYPERLINK(""bad"")",,-50.25');
  expect(csv).toContain("माउन्ट कैलाश");
  expect(csv).toContain(",,-50.25,");
  expect(csv).toContain("2 days pending; Round #7; Delivery staff");
  expect(dailyDocument(report).lines.some((l) => l.includes("-50.25"))).toBe(
    true,
  );
});
