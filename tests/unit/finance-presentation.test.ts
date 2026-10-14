import { expect, it } from "vitest";
import {
  emptyFinance,
  type Payment,
  type Invoice,
  type Sale,
} from "@/domain/finance/types";
import { emptyWorkspace } from "@/domain/operations/types";
import { financeHistory, paymentLabel } from "@/domain/finance/presentation";
const sale = {
  id: "sale",
  trip_id: "old-trip",
  driver_id: "driver",
  customer_id: "customer",
  business_day_id: "day",
} as Sale;
const payment = {
  id: "receipt",
  trip_id: "old-trip",
  customer_id: "customer",
  business_day_id: "day",
  created_at: "2026-10-14T10:00:00Z",
  method: "CASH",
  status: "CONFIRMED",
  amount: "150.25",
  deposit_amount: "50.00",
} as Payment;
const invoice = {
  id: "invoice",
  sale_id: "sale",
  date_label: "2026-10-14",
  created_at: "2026-10-14T10:00:00Z",
  total: "150.25",
  outstanding: "50.25",
} as Invoice;
const finance = {
  ...emptyFinance,
  sales: [sale],
  payments: [payment],
  invoices: [invoice],
};
const dates = new Map([["day", "2026-10-14"]]);
it("labels operator cash distinctly from admin-confirmed Fonepay and preserves disposition", () => {
  expect(paymentLabel(payment)).toBe("Cash recorded");
  expect(paymentLabel({ ...payment, method: "FONEPAY" })).toBe(
    "Admin reconciled",
  );
  for (const status of ["PENDING", "REJECTED", "REVERSED"] as const)
    expect(paymentLabel({ ...payment, status })).toBe(status);
});
it("filters both lists using immutable customer, trip and driver relationships", () => {
  expect(
    financeHistory(finance, emptyWorkspace, dates, {
      customer: "customer",
      driver: "driver",
      trip: "old-trip",
    }),
  ).toEqual({ payments: [payment], invoices: [invoice] });
  expect(
    financeHistory(finance, emptyWorkspace, dates, { customer: "other" }),
  ).toEqual({ payments: [], invoices: [] });
});
it("uses sale driver metadata when an older trip is outside the current workspace list", () => {
  expect(
    financeHistory(finance, emptyWorkspace, dates, { driver: "driver" })
      .payments,
  ).toEqual([payment]);
});
it("keeps method/status scope on receipts without inventing invoice payment categories", () => {
  expect(
    financeHistory(finance, emptyWorkspace, dates, {
      method: "FONEPAY",
      status: "PENDING",
    }),
  ).toEqual({ payments: [], invoices: [invoice] });
});
it("uses business dates for receipts and invoice dates for invoices without shifting Nepal dates", () => {
  expect(
    financeHistory(finance, emptyWorkspace, dates, {
      from: "2026-10-14",
      to: "2026-10-14",
    }).payments,
  ).toHaveLength(1);
  expect(
    financeHistory(finance, emptyWorkspace, dates, {
      from: "2026-10-15",
      to: "2026-10-15",
    }),
  ).toEqual({ payments: [], invoices: [] });
});
it("does not change source records, balances, ordering or the financial overview day scope", () => {
  const original = structuredClone(finance);
  const result = financeHistory(finance, emptyWorkspace, dates, {
    day: "another-day",
  });
  expect(result.payments).toEqual([payment]);
  expect(result.invoices).toEqual([invoice]);
  expect(finance).toEqual(original);
});
