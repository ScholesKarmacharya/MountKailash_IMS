import { expect, it } from "vitest";
import {
  deliveryFields,
  deliveryText,
  groupDeliveries,
  type ProductDelivery,
} from "@/domain/operations/product-delivery";
import { invoiceDocument, paymentDocument } from "@/domain/finance/documents";
import { invoicePaymentStatus } from "@/domain/finance/reports";
import {
  emptyFinance,
  type Invoice,
  type Company,
  type FinanceWorkspace,
  type Payment,
} from "@/domain/finance/types";

const carton: ProductDelivery = {
  product_id: "carton",
  kind: "BOTTLE_CARTON",
  name: "20L reusable jar label",
  visit_id: "visit",
  full_jars: 0,
  empty_jars: 0,
  cartons: 5,
};
const jar: ProductDelivery = {
  product_id: "jar",
  kind: "FULL_JAR",
  name: "Water carton label",
  visit_id: "visit",
  full_jars: 12,
  empty_jars: 8,
  cartons: 0,
};
const company: Company = {
  name: "Test",
  address: "",
  phone: "",
  registration: "",
  tax_mode: "UNCONFIGURED",
  tax_label: "",
  tax_rate: "0.00",
  version: 1,
};
const invoice: Invoice = {
  id: "invoice",
  number: "1",
  sale_id: "sale",
  company,
  customer: { name: "Customer", shop_name: "", address: "", phone: "" },
  date_label: "2026-10-12",
  due_date: null,
  subtotal: "751.25",
  tax: "0.00",
  total: "751.25",
  outstanding: "0.00",
  available: "0.00",
  created_at: "2026-10-12T12:00:00Z",
};
function finance(lines: ProductDelivery[]): FinanceWorkspace {
  return {
    ...emptyFinance,
    available: true,
    company,
    delivery_items: lines,
    invoices: [invoice],
    sales: [
      {
        id: "sale",
        visit_id: "visit",
        customer_id: "customer",
        trip_id: "trip",
        driver_id: "driver",
        vehicle_id: "vehicle",
        business_day_id: "day",
        created_at: invoice.created_at,
      },
    ],
    items: [],
  };
}
it("uses database kind even when product names suggest the opposite", () => {
  expect(deliveryFields(carton)).toEqual([
    { label: "Cartons Delivered", quantity: 5 },
  ]);
  expect(deliveryText(carton)).toContain("Cartons Delivered: 5");
  expect(deliveryText(carton)).not.toMatch(
    /Jars Delivered|Empty Jars Returned|Unreturned Jars/,
  );
  expect(deliveryFields(jar).map((f) => f.quantity)).toEqual([12, 8, 4]);
  expect(deliveryText(jar)).not.toContain("Cartons Delivered");
});
it("keeps signed visit changes and independent mixed product totals", () => {
  const returned = { ...jar, full_jars: 10, empty_jars: 12 };
  expect(deliveryFields(returned)[2]?.quantity).toBe(-2);
  const grouped = groupDeliveries([jar, returned, carton]);
  expect(grouped).toHaveLength(2);
  expect(grouped[0]).toMatchObject({
    full_jars: 22,
    empty_jars: 20,
    cartons: 0,
  });
  expect(grouped[1]).toMatchObject({ full_jars: 0, empty_jars: 0, cartons: 5 });
});
it("translates all product-specific fields and digits into Nepali", () => {
  expect(deliveryText(carton, "ne")).toContain("पानीका कार्टुन");
  expect(deliveryText(carton, "ne")).toContain("डेलिभरी भएका कार्टुन: ५");
  const text = deliveryText(jar, "ne");
  for (const label of [
    "पानीका जार",
    "डेलिभरी भएका जार: १२",
    "फिर्ता आएका खाली जार: ८",
    "फिर्ता आउन बाँकी जार: ४",
  ])
    expect(text).toContain(label);
  expect(text).not.toContain("डेलिभरी भएका कार्टुन:");
});
it("invoice and allocated receipt documents contain only applicable delivery fields without changing money", () => {
  const f = finance([carton]);
  const receipt: Payment = {
    id: "payment",
    number: "1",
    customer_id: "customer",
    trip_id: "trip",
    current_invoice_id: "invoice",
    company_snapshot: company,
    customer_snapshot: invoice.customer,
    business_day_id: "day",
    actor_user_id: "driver",
    method: "CASH",
    status: "CONFIRMED",
    amount: "751.25",
    deposit_amount: "0.00",
    reference: "",
    created_at: invoice.created_at,
  };
  f.payments = [receipt];
  f.allocations = [
    {
      id: "allocation",
      invoice_id: "invoice",
      payment_id: "payment",
      amount: "751.25",
    },
  ];
  for (const doc of [
    invoiceDocument(invoice, f),
    paymentDocument(receipt, f, invoice.date_label),
  ]) {
    expect(doc.lines.join("\n")).toContain("Cartons Delivered: 5");
    expect(doc.lines.join("\n")).not.toMatch(
      /Jars Delivered|Empty Jars Returned|Unreturned Jars/,
    );
    expect(doc.lines.join("\n")).toContain("NPR 751.25");
  }
  const mixed = invoiceDocument(invoice, finance([jar, carton])).lines.join(
    "\n",
  );
  expect(mixed).toContain("Unreturned Jars: 4");
  expect(mixed).toContain("Cartons Delivered: 5");
  expect(mixed).toContain("Total Amount: NPR 751.25");
  expect(mixed).toContain("Payment Status: Paid");
});
it("historical partial and pending payments retain truthful status", () => {
  const f = finance([jar]);
  expect(
    invoicePaymentStatus(
      { ...invoice, outstanding: "751.25", available: "751.25" },
      f,
    ),
  ).toBe("Credit");
  expect(
    invoicePaymentStatus(
      { ...invoice, outstanding: "500.00", available: "500.00" },
      f,
    ),
  ).toBe("Partially paid");
  expect(
    invoicePaymentStatus(
      { ...invoice, outstanding: "500.00", available: "400.00" },
      f,
    ),
  ).toBe("Pending payment");
});
