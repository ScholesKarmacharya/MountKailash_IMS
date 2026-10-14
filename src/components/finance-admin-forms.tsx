import { T, Value } from "@/components/localization";
import { randomUUID } from "node:crypto";
import { OperationForm, Field, Select } from "./operation-form";
import { Card } from "./ui/card";
import type {
  FinanceWorkspace,
  Payment,
  Company,
} from "@/domain/finance/types";
import type { Workspace } from "@/domain/operations/types";
import { TaxTreatmentField } from "./finance-filters";
const Reason = () => (
  <Field label="Reason / evidence" name="reason" required maxLength={500} />
);
export function CompanyForm({ company: c }: { company: Company }) {
  return (
    <OperationForm
      operation="finance:COMPANY"
      requestKey={randomUUID()}
      version={c.version}
      label="Save confirmed billing settings"
      confirm="Save these company details and confirmed tax treatment? Future invoices use these settings; historical invoices retain their snapshots."
      preserveFields
    >
      <section className="space-y-4 rounded-lg border border-border p-4">
        <h2 className="text-lg font-semibold">
          <T k="Company information" />
        </h2>
        <div className="grid items-start gap-4 sm:grid-cols-2">
          <Field
            name="name"
            label="Company name"
            value={c.name}
            required
            maxLength={120}
          />
          <Field
            name="address"
            label="Company address"
            value={c.address}
            maxLength={500}
          />
          <Field name="phone" label="Phone" value={c.phone} maxLength={40} />
        </div>
      </section>
      <section className="space-y-4 rounded-lg border border-border p-4">
        <h2 className="text-lg font-semibold">
          <T k="Registration and tax details" />
        </h2>
        <p className="text-sm text-muted-foreground">
          <T k="Use confirmed registration and tax evidence. No tax status is inferred." />
        </p>
        <div className="grid items-start gap-4 sm:grid-cols-2">
          <Field
            name="registration"
            label="Confirmed registration details (optional)"
            value={c.registration}
            maxLength={120}
          />
          <TaxTreatmentField value={c.tax_mode} />
          <Field
            name="tax_label"
            label="Confirmed tax label"
            value={c.tax_label}
            maxLength={100}
          />
          <Field
            name="tax_rate"
            label="Confirmed percentage (0–100, max 2 decimals)"
            value={c.tax_rate}
            required
          />
        </div>
      </section>
      <section className="space-y-4 rounded-lg border border-border p-4">
        <h2 className="text-lg font-semibold">
          <T k="Documentation and evidence" />
        </h2>
        <Reason />
      </section>
    </OperationForm>
  );
}
export function PaymentReview({
  payment: p,
  day,
}: {
  payment: Payment;
  day: string | null;
}) {
  if (!day)
    return (
      <p>
        <T k="Open a business day before reconciliation or reversal." />
      </p>
    );
  return (
    <OperationForm
      operation={p.status === "PENDING" ? "finance:VERIFY" : "finance:REVERSE"}
      requestKey={randomUUID()}
      label={
        p.status === "PENDING"
          ? "Save reconciliation decision"
          : "Reverse receipt"
      }
      confirm={
        p.status === "PENDING"
          ? "Record your explicit merchant/bank reconciliation decision? A reference alone is not evidence."
          : "Reverse this receipt with an audited compensating transaction?"
      }
    >
      <input type="hidden" name="payment" value={p.id} />
      <input type="hidden" name="day" value={day} />
      {p.status === "PENDING" && (
        <>
          <Select name="decision" label="Reconciliation decision">
            <option value="REJECT">
              <T k="Reject - payment not received" />
            </option>
            <option value="CONFIRM">
              <T k="Confirm - independently matched settlement" />
            </option>
          </Select>
          <Field
            name="reference"
            label="Matched transaction reference"
            value={p.reference}
            maxLength={200}
          />
        </>
      )}
      <Reason />
    </OperationForm>
  );
}
export function CustomerBillingForms({
  id,
  finance: f,
  workspace: w,
}: {
  id: string;
  finance: FinanceWorkspace;
  workspace: Workspace;
}) {
  const b = f.billing.find((b) => b.customer_id === id),
    day = w.days.find((d) => d.status === "OPEN");
  return (
    <div className="space-y-5">
      <Card>
        <h2 className="mb-4 font-semibold">
          <T k="Credit and deposit arrangement" />
        </h2>
        <OperationForm
          operation="finance:BILLING"
          requestKey={randomUUID()}
          version={b?.version ?? 0}
          label="Save customer billing arrangement"
        >
          <input type="hidden" name="customer" value={id} />
          <Select
            name="account_type"
            label="Account type"
            value={b?.account_type ?? "STANDARD"}
          >
            <option value="STANDARD">
              <T k="Standard" />
            </option>
            <option value="MONTHLY_CREDIT">
              <T k="Monthly credit" />
            </option>
          </Select>
          <Field
            name="due_days"
            label="Invoice due after days (0–365; blank means unconfigured)"
            value={b?.due_days?.toString() ?? ""}
          />
          <Select
            name="deposit_mode"
            label="Deposit arrangement"
            value={b?.deposit_mode ?? "NONE"}
          >
            <option value="NONE">
              <T k="No deposit" />
            </option>
            <option value="MANUAL">
              <T k="Explicit manual deposit receipts and refunds" />
            </option>
          </Select>
          <Reason />
          <p className="text-sm text-muted-foreground">
            <T k="Monthly credit balances carry forward. Due days start from the invoice's Nepal business date. No automatic deposit rate, refund, credit limit or jar/debt offset is assumed." />
          </p>
        </OperationForm>
      </Card>
      <Card>
        <h2 className="mb-4 font-semibold">
          <T k="Approved customer prices" />
        </h2>
        {w.products.map((p) => {
          const price = f.prices.find(
            (r) => r.customer_id === id && r.product_id === p.id,
          );
          return (
            <details key={p.id} className="mb-4 rounded-lg border p-4">
              <summary className="cursor-pointer font-semibold">
                {p.name} ·{" "}
                {price?.active ? (
                  <Value value={`NPR ${price.price}`} />
                ) : (
                  <T
                    k="Default NPR {0}"
                    values={[<Value key="price" value={p.default_price} />]}
                  />
                )}
              </summary>
              <div className="mt-4">
                <OperationForm
                  operation="finance:PRICE"
                  requestKey={randomUUID()}
                  version={price?.version ?? 0}
                  label="Approve price"
                >
                  <input type="hidden" name="customer" value={id} />
                  <input type="hidden" name="product" value={p.id} />
                  <Field
                    name="price"
                    label="Approved unit price (NPR)"
                    value={price?.price ?? p.default_price}
                    required
                  />
                  <Select
                    name="active"
                    label="Use this price"
                    value={String(price?.active ?? true)}
                  >
                    <option value="true">
                      <T k="Active negotiated price" />
                    </option>
                    <option value="false">
                      <T k="Inactive - use product default" />
                    </option>
                  </Select>
                  <Reason />
                </OperationForm>
              </div>
            </details>
          );
        })}
      </Card>
      {day && (
        <Card>
          <h2 className="mb-4 font-semibold">
            <T k="Explicit deposit refund" />
          </h2>
          <OperationForm
            operation="finance:REFUND"
            requestKey={randomUUID()}
            label="Record cash deposit refund"
            confirm="Record an actual cash refund from this customer's refundable deposit liability? Empty collection does not imply a refund."
          >
            <input type="hidden" name="customer" value={id} />
            <input type="hidden" name="day" value={day.id} />
            <Field name="amount" label="Actual cash refund (NPR)" required />
            <Reason />
          </OperationForm>
        </Card>
      )}
    </div>
  );
}
