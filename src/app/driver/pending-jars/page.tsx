import { getPendingJars } from "@/services/pending-jars";
import { PendingJars } from "@/components/pending-jars";
import { OperationalRefresh } from "@/components/operational-refresh";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ customer?: string }>;
}) {
  const pending = await getPendingJars(
    false,
    undefined,
    (await searchParams).customer,
  );
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <h1 className="text-3xl font-bold">Pending Jars</h1>
      <OperationalRefresh />
      <PendingJars workspace={pending} />
    </div>
  );
}
