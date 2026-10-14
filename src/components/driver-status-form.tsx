"use client";
import { useState } from "react";
import type { DriverAccount } from "@/domain/auth/accounts";
import { Field, OperationForm } from "./operation-form";
import { Button } from "./ui/button";
import { Message, useLocale } from "./localization";
export function DriverStatusForm({
  driver,
  requestKey,
}: {
  driver: DriverAccount;
  requestKey: string;
}) {
  const { t } = useLocale();
  const actions =
    driver.approval_status === "APPROVED"
      ? [{ status: "SUSPENDED", label: "Suspend Driver" }]
      : driver.approval_status === "PENDING"
        ? [
            { status: "APPROVED", label: "Approve Driver" },
            { status: "REJECTED", label: "Reject Driver" },
          ]
        : [
            {
              status: "APPROVED",
              label:
                driver.approval_status === "SUSPENDED"
                  ? "Reactivate Driver"
                  : "Approve Driver",
            },
          ];
  const [selected, setSelected] = useState(actions[0]!);
  return (
    <OperationForm
      operation="account:status"
      id={driver.id}
      version={driver.version}
      requestKey={requestKey}
      label={selected.label}
      confirm={
        selected.status === "SUSPENDED"
          ? "Suspend this driver? New operations will be blocked immediately; historical records will remain."
          : "Apply this account access change?"
      }
      preserveFields
    >
      {actions.length > 1 && (
        <div
          role="group"
          aria-label={t("Approval action")}
          className="flex flex-wrap gap-2"
        >
          {actions.map((action) => (
            <Button
              key={action.status}
              type="button"
              aria-label={t(
                action.status === "APPROVED"
                  ? "Select approval"
                  : "Select rejection",
              )}
              variant={
                action.status === selected.status ? "default" : "outline"
              }
              aria-pressed={action.status === selected.status}
              onClick={() => setSelected(action)}
            >
              <Message value={action.label} />
            </Button>
          ))}
        </div>
      )}
      <input type="hidden" name="status" value={selected.status} />
      <Field
        name="reason"
        label="Reason for this change"
        required
        maxLength={500}
      />
    </OperationForm>
  );
}
