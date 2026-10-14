import Link from "next/link";
import { notFound } from "next/navigation";
import { getAdminJars, getAdminJarHistory } from "@/services/admin-jars";
import { AdminJarCards } from "@/components/admin-jar-cards";
import { CustomerJarHistory } from "@/components/customer-jar-history";
import { OperationsHeading } from "@/components/operations-layout";
import { OperationalRefresh } from "@/components/operational-refresh";
import { T } from "@/components/localization";
import { Card } from "@/components/ui/card";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ customer?: string | string[] }>;
}) {
  const w = await getAdminJars();
  const { customer } = await searchParams;
  if (
    customer &&
    (typeof customer !== "string" ||
      !w.customers.some((c) => c.id === customer))
  ) {
    if (w.available) notFound();
  }
  const history =
    w.available && typeof customer === "string"
      ? await getAdminJarHistory(customer)
      : null;
  return (
    <div className="space-y-6">
      <OperationsHeading
        title="Unreturned Jars"
        description="Confirmed customer jar balances carry forward across trips and business days."
      />
      <OperationalRefresh />
      {!w.available ? (
        <Card>
          <p role="status">
            <T k="The admin jar migration is required. Apply migration 24, then refresh." />
          </p>
        </Card>
      ) : (
        <AdminJarCards workspace={w}>
          {history && (
            <div id="customer-jar-history" className="scroll-mt-4 space-y-4">
              <Link
                href="/admin/pending-jars"
                className="text-sm font-semibold text-primary underline"
              >
                <T k="Back to unreturned jars" />
              </Link>
              <CustomerJarHistory history={history} />
            </div>
          )}
        </AdminJarCards>
      )}
    </div>
  );
}
