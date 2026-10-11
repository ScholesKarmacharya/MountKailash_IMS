export type Company = {
  name: string;
  address: string;
  phone: string;
  registration: string;
  tax_mode: "UNCONFIGURED" | "NO_TAX" | "EXPLICIT";
  tax_label: string;
  tax_rate: string;
  version: number;
};
export type Sale = {
  id: string;
  visit_id: string;
  customer_id: string | null;
  trip_id: string;
  driver_id: string;
  vehicle_id: string;
  business_day_id: string;
  created_at: string;
};
export type Invoice = {
  id: string;
  number: string;
  sale_id: string;
  company: Company;
  customer: { name: string; shop_name: string; address: string; phone: string };
  date_label: string;
  due_date: string | null;
  subtotal: string;
  tax: string;
  total: string;
  outstanding: string;
  available: string;
  created_at: string;
};
export type SaleItem = {
  id: string;
  sale_id: string;
  product_id: string;
  name: string;
  sku: string;
  unit: string;
  quantity: number;
  unit_price: string;
  total: string;
};
export type Payment = {
  id: string;
  number: string;
  customer_id: string | null;
  trip_id: string;
  current_invoice_id: string | null;
  company_snapshot: Company;
  customer_snapshot: Invoice["customer"];
  business_day_id: string;
  actor_user_id: string;
  method: "CASH" | "FONEPAY";
  status: "PENDING" | "CONFIRMED" | "REJECTED" | "REVERSED";
  amount: string;
  deposit_amount: string;
  reference: string;
  created_at: string;
};
export type Allocation = {
  id: string;
  payment_id: string;
  invoice_id: string;
  amount: string;
};
export type Verification = {
  id: string;
  sequence: number;
  payment_id: string;
  status: Payment["status"];
  source: string;
  reference: string;
  evidence: string;
  business_day_id: string;
  actor_user_id: string;
  created_at: string;
};
export type Adjustment = {
  id: string;
  invoice_id: string;
  subtotal_delta: string;
  tax_delta: string;
  reason: string;
  business_day_id: string;
  created_at: string;
};
export type Credit = {
  id: string;
  number: string;
  customer_id: string;
  date_label: string;
  due_date: string | null;
  outstanding: string;
  available: string;
};
export type Deposit = {
  id: string;
  customer_id: string;
  payment_id: string | null;
  kind: string;
  amount: string;
  reason: string;
  business_day_id: string;
  created_at: string;
};
export type Ledger = {
  id: string;
  customer_id: string;
  invoice_id: string;
  kind: string;
  amount: string;
  business_day_id: string;
  created_at: string;
};
export type Journal = {
  id: string;
  posting_id: string;
  source_id: string;
  kind: string;
  account: string;
  amount: string;
  business_day_id: string;
  created_at: string;
};
export type Billing = {
  customer_id: string;
  account_type: "STANDARD" | "MONTHLY_CREDIT";
  due_days: number | null;
  deposit_mode: "NONE" | "MANUAL";
  version: number;
};
export type Price = {
  customer_id: string;
  product_id: string;
  price: string;
  active: boolean;
  version: number;
};
export type FinanceWorkspace = {
  available: boolean;
  company: Company | null;
  billing: Billing[];
  prices: Price[];
  sales: Sale[];
  items: SaleItem[];
  invoices: Invoice[];
  payments: Payment[];
  allocations: Allocation[];
  events: Verification[];
  adjustments: Adjustment[];
  credit: Credit[];
  deposits: Deposit[];
  ledger: Ledger[];
  journal: Journal[];
  issued: { invoice_id: string; amount: string }[];
};
export const emptyFinance: FinanceWorkspace = {
  available: false,
  company: null,
  billing: [],
  prices: [],
  sales: [],
  items: [],
  invoices: [],
  payments: [],
  allocations: [],
  events: [],
  adjustments: [],
  credit: [],
  deposits: [],
  ledger: [],
  journal: [],
  issued: [],
};
export type PaymentDraft = {
  method: "CASH" | "FONEPAY";
  amount: string;
  current_amount?: string;
  deposit_amount: string;
  reference: string;
  allocations: { invoice_id: string; amount: string }[];
};
