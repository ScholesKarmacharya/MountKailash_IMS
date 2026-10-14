import { T, Value } from "@/components/localization";
import { randomUUID } from "node:crypto";
import type { Customer, Vehicle, Workspace } from "@/domain/operations/types";
import { OperationForm, Field, Select } from "./operation-form";
import { Card } from "./ui/card";
import { HouseCustomerFields } from "./house-customer-fields";
import { DialogClose } from "./admin-dialog";
import { MasterStatus } from "./master-select-fields";
function Status({
  active = true,
  lockActive = false,
}: {
  active?: boolean;
  lockActive?: boolean;
}) {
  return <MasterStatus active={active} lockActive={lockActive} />;
}
export function CustomerForm({
  customer,
  dialog = false,
}: {
  customer?: Customer;
  dialog?: boolean;
}) {
  return (
    <OperationForm
      operation="customer"
      id={customer?.id ?? randomUUID()}
      version={customer?.version}
      requestKey={randomUUID()}
      label={customer ? "Save customer" : "Create customer"}
      preserveFields
      actions={dialog ? <DialogClose /> : undefined}
      successActions={dialog ? <DialogClose label="Close" /> : undefined}
    >
      <p className="text-sm text-muted-foreground">
        <T k="Customer name and audit reason are required. Other contact fields are optional." />
      </p>
      <div className="grid items-start gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <HouseCustomerFields customer={customer} admin compact />
        </div>
        <Field
          name="contact_person"
          label="Contact person (optional)"
          value={customer?.contact_person}
          maxLength={120}
        />
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
      </div>
      <Field
        name="reason"
        label="Reason for this change"
        required
        maxLength={500}
      />
    </OperationForm>
  );
}
export function VehicleForm({
  vehicle,
  dialog = false,
  hasOpenTrip = false,
}: {
  vehicle?: Vehicle;
  dialog?: boolean;
  hasOpenTrip?: boolean;
}) {
  return (
    <OperationForm
      operation="vehicle"
      id={vehicle?.id ?? randomUUID()}
      version={vehicle?.version}
      requestKey={randomUUID()}
      label={vehicle ? "Save vehicle" : "Register vehicle"}
      preserveFields
      actions={dialog ? <DialogClose /> : undefined}
      successActions={dialog ? <DialogClose label="Close" /> : undefined}
    >
      <p className="text-sm text-muted-foreground">
        <T k="Number plate and audit reason are required." />
      </p>
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
      <Status
        active={vehicle?.is_active}
        lockActive={hasOpenTrip && vehicle?.is_active}
      />
      {hasOpenTrip && (
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          <T k="Complete or cancel the current trip before deactivating this vehicle." />
        </p>
      )}
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
    <Card id="customer-custody">
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
