import { describe, it, expect } from "vitest";
import { cents, decimal, sum, allocations } from "@/domain/finance/money";
import { paymentPlan } from "@/domain/finance/payment-plan";
import { paymentDraft, financeCommand } from "@/domain/finance/commands";
import { can } from "@/domain/auth/roles";
import { randomUUID } from "node:crypto";
import { creditAging } from "@/domain/finance/aging";
describe("finance domain", () => {
  it("ages configured credit by Nepal date labels while preserving unconfigured due dates", () => {
    const invoices = [
      {
        id: "a",
        number: "1",
        customer_id: "c",
        date_label: "2026-08-01",
        due_date: "2026-08-01",
        outstanding: "50.25",
        available: "50.25",
      },
      {
        id: "b",
        number: "2",
        customer_id: "c",
        date_label: "2026-10-11",
        due_date: null,
        outstanding: "100",
        available: "100",
      },
    ];
    const a = creditAging(invoices, "2026-10-11");
    expect(a.find((b) => b.label === "61–90 days overdue")?.amount).toBe(
      "50.25",
    );
    expect(a.find((b) => b.label === "Due unconfigured")?.amount).toBe(
      "100.00",
    );
  });
  it("adds exact money and handles the supported database range", () => {
    expect(sum(["0.10", "0.20"])).toBe("0.30");
    expect(sum(["999999999999.99", "999999999999.99"])).toBe(
      "1999999999999.98",
    );
    expect(decimal(cents("999999999999.99"))).toBe("999999999999.99");
    expect(sum(["-2.50", "3.00"])).toBe("0.50");
    for (const value of ["1.001", "NaN", "1e2", "Infinity"])
      expect(() => cents(value)).toThrow();
  });
  it("allocates old credit oldest first without allocating reserved amounts", () => {
    const i = [
      { id: "a", available: "100", date_label: "2026-01-02" },
      { id: "b", available: "50", date_label: "2026-01-01" },
    ];
    expect(allocations("75", i)).toEqual([
      { invoice_id: "b", amount: "50.00" },
      { invoice_id: "a", amount: "25.00" },
    ]);
    expect(() => allocations("151", i)).toThrow();
  });
  it("plans mixed cash and pending Fonepay with remaining credit", () => {
    const p = paymentPlan({
      selection: "PARTIAL",
      total: "100",
      amount: "25",
      fonepayPart: "50",
    });
    expect(p.map((p) => [p.method, p.amount])).toEqual([
      ["CASH", "25.00"],
      ["FONEPAY", "50.00"],
    ]);
    expect(() =>
      paymentPlan({ selection: "PARTIAL", total: "100", amount: "101" }),
    ).toThrow();
  });
  it("whitelists payment fields and discards browser verification, price and identity", () => {
    const p = paymentDraft({
      method: "FONEPAY",
      amount: "10",
      allocations: [],
      verified: true,
      actor: "forged",
      unit_price: "0",
    });
    expect(p).not.toHaveProperty("verified");
    expect(p).not.toHaveProperty("actor");
    expect(p).not.toHaveProperty("unit_price");
  });
  it("requires admin finance management while permitting assigned workflow collection", () => {
    const driver = {
      id: randomUUID(),
      name: "Driver",
      role: "DRIVER" as const,
      is_active: true,
    };
    expect(can(driver, "finance:manage")).toBe(false);
    expect(can(driver, "payment:record")).toBe(true);
    expect(can({ ...driver, is_active: false }, "payment:record")).toBe(false);
  });
  it("classifies privileged commands on the server and validates reasons", () => {
    const form = new FormData();
    Object.entries({
      operation: "finance:REFUND",
      key: randomUUID(),
      customer: randomUUID(),
      day: randomUUID(),
      amount: "50.00",
      reason: "Explicit approved refund",
    }).forEach(([k, v]) => form.set(k, v));
    expect(financeCommand(form).admin).toBe(true);
    form.set("reason", "");
    expect(() => financeCommand(form)).toThrow();
  });
});
