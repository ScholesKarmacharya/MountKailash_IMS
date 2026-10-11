import "server-only";
// Implementations must validate signatures, merchant, currency, amount, settlement and replay identity.
// No client-provided reference can construct this trusted server-side confirmation.
export type VerifiedProviderPayment = {
  provider: string;
  transactionId: string;
  merchantId: string;
  currency: "NPR";
  amount: string;
  paymentId: string;
};
export interface PaymentProvider {
  readonly name: string;
  verifyCallback(
    body: Uint8Array,
    headers: Headers,
  ): Promise<VerifiedProviderPayment>;
}
export function configuredFonepayProvider(): PaymentProvider | null {
  return null;
}
// Fonepay remains disabled until official merchant APIs, credentials and signature requirements are supplied.
