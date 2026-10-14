"use client";
import { Select } from "../operation-form";
import { useLocale } from "../localization";
export function OfflineReviewFields({
  kind,
  house,
  customers,
}: {
  kind: string;
  house: boolean;
  customers: { id: string; name: string; phone: string; is_active: boolean }[];
}) {
  const { t } = useLocale();
  return (
    <>
      <Select name="action" label="Review action">
        <option value="RETRY">{t("Retry original record")}</option>
        {kind === "CUSTOMER" && (
          <option value="MATCH_CUSTOMER">{t("Match existing customer")}</option>
        )}
        {kind === "DELIVERY" && (
          <option value="REBASE_CUSTODY">
            {t("Authorize current jar balance")}
          </option>
        )}
        {kind === "DELIVERY" && house && (
          <option value="AUTHORIZE_HOUSE">
            {t("Authorize original free supply")}
          </option>
        )}
        <option value="REJECT">{t("Reject and preserve evidence")}</option>
      </Select>
      {kind === "CUSTOMER" && (
        <Select name="customer" label="Matching customer" required={false}>
          <option value="">{t("Select customer")}</option>
          {customers
            .filter((c) => c.is_active)
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} · {c.phone}
              </option>
            ))}
        </Select>
      )}
    </>
  );
}
