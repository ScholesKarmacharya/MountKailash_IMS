import { PaymentDetail } from "@/components/payment-detail";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return <PaymentDetail id={(await params).id} admin />;
}
