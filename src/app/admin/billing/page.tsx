import { T } from "@/components/localization";
import { getFinance } from "@/services/finance";
import { FinanceRequired } from "@/components/finance-overview";
import { CompanyForm } from "@/components/finance-admin-forms";
import { Card } from "@/components/ui/card";
export default async function Page() {
  const f = await getFinance(true);
  if (!f.available || !f.company) return <FinanceRequired />;
  return (
    <div className="space-y-5" data-testid="billing-workspace">
      <h1 className="text-3xl font-bold">
        <T k="Billing settings" />
      </h1>
      <p className="text-sm text-muted-foreground">
        <T k="Save confirmed company and tax details. Unconfigured tax remains explicitly labeled on invoices; no VAT or PAN status is inferred." />
      </p>
      <Card>
        <CompanyForm company={f.company} />
      </Card>
    </div>
  );
}
