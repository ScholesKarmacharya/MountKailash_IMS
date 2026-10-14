import { randomUUID } from "node:crypto";
import type { DriverAccount } from "@/domain/auth/accounts";
import type { Profile } from "@/domain/auth/roles";
import { Field, OperationForm } from "./operation-form";
import { DriverCreationApproval } from "./master-select-fields";
import { T } from "./localization";
import { DriverStatusForm } from "./driver-status-form";
import { DialogClose } from "./admin-dialog";
export function OwnProfileForm({ profile }: { profile: Profile | null }) {
  return (
    <OperationForm
      operation="account:profile"
      version={profile?.version ?? 0}
      requestKey={randomUUID()}
      label="Save profile"
    >
      <Field
        name="name"
        label="Full name"
        value={profile?.name}
        required
        maxLength={120}
      />
      <Field
        name="phone"
        label="Phone (optional)"
        value={profile?.phone}
        maxLength={40}
      />
    </OperationForm>
  );
}
export function DriverAccountForm({
  driver,
  dialog = false,
}: {
  driver?: DriverAccount;
  dialog?: boolean;
}) {
  return (
    <OperationForm
      operation="account:driver"
      id={driver?.id}
      version={driver?.version}
      requestKey={randomUUID()}
      label={driver ? "Save driver" : "Create pending driver"}
      preserveFields
      actions={dialog ? <DialogClose /> : undefined}
      successActions={dialog ? <DialogClose label="Close" /> : undefined}
    >
      <input type="hidden" name="create_new" value={String(!driver)} />
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
        label="Full name"
        value={driver?.name}
        required
        maxLength={120}
      />
      <Field
        name="phone"
        label="Phone (optional)"
        value={driver?.phone}
        maxLength={40}
      />
      {!driver && <DriverCreationApproval />}
      <Field
        name="reason"
        label="Reason for this change"
        required
        maxLength={500}
      />
      {!driver && (
        <p className="text-sm text-muted-foreground">
          <T k="Email comes from the existing Auth account. Pending drivers cannot access operations." />
        </p>
      )}
    </OperationForm>
  );
}
export function DriverAccessActions({ driver }: { driver: DriverAccount }) {
  return (
    <DriverStatusForm
      key={driver.version}
      driver={driver}
      requestKey={randomUUID()}
    />
  );
}
