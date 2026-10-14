"use client";
import { Select } from "./operation-form";
import { useLocale } from "./localization";
export function MasterStatus({
  active = true,
  lockActive = false,
}: {
  active?: boolean;
  lockActive?: boolean;
}) {
  const { t } = useLocale();
  return (
    <Select name="active" label="Status" value={String(active)}>
      <option value="true">{t("Active")}</option>
      <option value="false" disabled={lockActive}>
        {t("Inactive")}
      </option>
    </Select>
  );
}
export function DriverCreationApproval() {
  const { t } = useLocale();
  return (
    <Select label="Approval on creation" name="approve" value="false">
      <option value="false">{t("Pending Approval")}</option>
      <option value="true">{t("Approve Driver")}</option>
    </Select>
  );
}
