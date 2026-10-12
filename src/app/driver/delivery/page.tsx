import { DriverRoundWorkspace } from "@/components/driver-round-workspace";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ customer?: string }>;
}) {
  return (
    <DriverRoundWorkspace initialCustomer={(await searchParams).customer} />
  );
}
