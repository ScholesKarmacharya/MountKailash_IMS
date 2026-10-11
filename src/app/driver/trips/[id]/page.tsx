import { TripDetail } from "@/components/trip-summary";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return <TripDetail id={(await params).id} admin={false} />;
}
