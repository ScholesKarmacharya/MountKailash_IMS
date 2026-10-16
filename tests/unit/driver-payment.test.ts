import { expect, it } from "vitest";
import { driverPaymentPlan } from "@/domain/finance/driver-payment";
import { parseCommand } from "@/domain/operations/commands";
const id = "00000000-0000-0000-0000-000000000001";
const paid = (amount: string) =>
  driverPaymentPlan({ status: "PAID", total: "300.50", amount, customer: id });
it("records a Fonepay delivery as pending digital payment rather than cash", () => {
  expect(
    driverPaymentPlan({
      status: "FONEPAY",
      total: "300.50",
      amount: "300.50",
      customer: id,
    }),
  ).toEqual([
    expect.objectContaining({
      method: "FONEPAY",
      amount: "300.50",
      current_amount: "300.50",
    }),
  ]);
  expect(parseCommand(form("FONEPAY"))).toMatchObject({
    args: { p_status: "FONEPAY", p_received: "300.50" },
  });
});
it("requires an explicit exact Paid amount and creates only the current cash receipt", () => {
  expect(paid("300.5")).toEqual([
    {
      method: "CASH",
      amount: "300.50",
      current_amount: "300.50",
      deposit_amount: "0.00",
      reference: "",
      allocations: [],
    },
  ]);
});
it.each(["", "300.49", "300.51", "-300.50", "300.501", "NaN"])(
  "rejects invalid or unequal Paid amount %s",
  (amount) => {
    expect(() => paid(amount)).toThrow();
  },
);
it("Credit requires a registered customer and collects nothing, regardless of an old Paid draft", () => {
  expect(
    driverPaymentPlan({
      status: "CREDIT",
      total: "300.50",
      amount: "300.50",
      customer: id,
    }),
  ).toEqual([]);
  expect(() =>
    driverPaymentPlan({
      status: "CREDIT",
      total: "300.50",
      amount: "",
      customer: null,
    }),
  ).toThrow("registered customer");
});
it("empty-only returns do not create payments", () => {
  expect(
    driverPaymentPlan({
      status: "RETURN_ONLY",
      total: "0.00",
      amount: "300.50",
      customer: id,
    }),
  ).toEqual([]);
});
function form(status = "PAID", amount = "300.50") {
  const f = new FormData();
  for (const [k, v] of Object.entries({
    operation: "driver-visit",
    key: id,
    trip: id,
    customer: id,
    walk_name: "",
    walk_phone: "",
    items: "[]",
    notes: "",
    payment_status: status,
    received_amount: amount,
    finance_payments: '[{"method":"FONEPAY","amount":"1000"}]',
    invoice_total: "1",
    actor: id,
    role: "ADMIN",
  }))
    f.set(k, v);
  return f;
}
it("the server command forwards no client prices, payment allocations, actor or role", () => {
  expect(parseCommand(form())).toEqual({
    admin: false,
    rpc: "post_driver_delivery",
    args: {
      p_trip: id,
      p_customer: id,
      p_walk_name: "",
      p_walk_phone: "",
      p_items: [],
      p_status: "PAID",
      p_received: "300.50",
      p_notes: "",
      p_key: id,
    },
  });
});
it("the server rejects forged credit collections and unregistered credit", () => {
  expect(() => parseCommand(form("CREDIT", "1"))).toThrow("cannot collect");
  const f = form("CREDIT", "");
  f.set("customer", "");
  expect(() => parseCommand(f)).toThrow("registered customer");
});
