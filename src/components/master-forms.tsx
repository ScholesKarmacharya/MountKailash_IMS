import { T, Value } from "@/components/localization";
import { randomUUID } from "node:crypto";
import type {
  Customer,
  Driver,
  Vehicle,
  Workspace,
} from "@/domain/operations/types";
import { OperationForm, Field, Select } from "./operation-form";
import { Card } from "./ui/card";
function Status({ active = true }: { active?: boolean }) {
  return (
    <Select name="active" label="Status" value={String(active)}>
      <option value="true">
        <T k="Active" />
      </option>
      <option value="false">
        <T k="Inactive" />
      </option>
    </Select>
  );
}
export function CustomerForm({ customer }: { customer?: Customer }) {
  return (
    <OperationForm
      operation="customer"
      id={customer?.id ?? randomUUID()}
      version={customer?.version}
      requestKey={randomUUID()}
      label={customer ? "Save customer" : "Create customer"}
    >
      <Field
        name="name"
        label="Customer name"
        value={customer?.name}
        required
        maxLength={120}
      />
      <Field
        name="shop_name"
        label="Shop / business"
        value={customer?.shop_name}
        maxLength={160}
      />
      <Field
        name="phone"
        label="Phone"
        value={customer?.phone}
        maxLength={40}
      />
      <Field
        name="address"
        label="Address"
        value={customer?.address}
        maxLength={500}
      />
      <Field name="notes" label="Notes" value={customer?.notes} />
      <Status active={customer?.is_active} />
      <Field
        name="reason"
        label="Reason for this change"
        required
        maxLength={500}
      />
    </OperationForm>
  );
}
export function VehicleForm({ vehicle }: { vehicle?: Vehicle }) {
  return (
    <OperationForm
      operation="vehicle"
      id={vehicle?.id ?? randomUUID()}
      version={vehicle?.version}
      requestKey={randomUUID()}
      label={vehicle ? "Save vehicle" : "Register vehicle"}
    >
      <Field
        name="plate_number"
        label="Number plate"
        value={vehicle?.plate_number}
        required
        maxLength={40}
      />
      <Field
        name="description"
        label="Description"
        value={vehicle?.description}
        maxLength={500}
      />
      <Status active={vehicle?.is_active} />
      <Field
        name="reason"
        label="Reason for this change"
        required
        maxLength={500}
      />
    </OperationForm>
  );
}
export function DriverForm({ driver }: { driver?: Driver }) {
  return (
    <OperationForm
      operation="driver"
      id={driver?.id}
      version={driver?.version}
      requestKey={randomUUID()}
      label={driver ? "Save driver" : "Authorize existing Auth account"}
    >
      {!driver && (
        <Field
          name="id"
          label="Existing Supabase Auth user UUID"
          required
          maxLength={36}
        />
      )}
      <Field
        name="name"
        label="Driver name"
        value={driver?.name}
        required
        maxLength={120}
      />
      <Status active={driver?.is_active} />
      <Field
        name="reason"
        label="Reason for this change"
        required
        maxLength={500}
      />
    </OperationForm>
  );
}
export function CustodyForm({
  workspace,
  customer,
}: {
  workspace: Workspace;
  customer: Customer;
}) {
  const day = workspace.days.find((d) => d.status === "OPEN");
  return (
    <Card>
      <h2 className="mb-3 font-semibold">
        <T k="Customer jar custody" />
      </h2>
      <p className="mb-5 text-sm text-muted-foreground">
        <T k="Physical jars held by this customer, separate from warehouse stock and financial deposits. Record verified legacy holdings here before collecting those empties." />
      </p>
      {workspace.custody
        .filter((c) => c.customer_id === customer.id)
        .map((c) => (
          <p key={c.product_id}>
            {workspace.products.find((p) => p.id === c.product_id)?.name}:{" "}
            <strong>
              <Value value={c.quantity} />
            </strong>
          </p>
        ))}
      {day ? (
        <OperationForm
          operation="custody"
          requestKey={randomUUID()}
          label="Post custody correction"
        >
          <input type="hidden" name="customer" value={customer.id} />
          <input type="hidden" name="day" value={day.id} />
          <Select name="product" label="Jar product">
            <option value="">
              <T k="Choose product" />
            </option>
            {workspace.products
              .filter((p) => p.kind === "FULL_JAR")
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </Select>
          <Field
            name="delta"
            label="Signed change (e.g. 10 or -5)"
            required
            maxLength={12}
          />
          <Field
            name="reason"
            label="Verified reason"
            required
            maxLength={500}
          />
        </OperationForm>
      ) : (
        <p className="mt-3 text-sm">
          <T k="Open a business day to post custody corrections." />
        </p>
      )}
      <div className="mt-5 space-y-2">
        {workspace.custody_history
          .filter((e) => e.customer_id === customer.id)
          .slice(0, 30)
          .map((e) => (
            <p className="text-sm" key={e.id}>
              <T
                k="{0} {1} · Balance {2} · {3}"
                values={[
                  e.delta > 0 ? "+" : "",
                  e.delta,
                  e.resulting_balance,
                  e.reason,
                ]}
              />
            </p>
          ))}
      </div>
    </Card>
  );
}
