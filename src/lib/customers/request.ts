import {
  CustomerLookupError,
  customerErrorMessages,
  type CustomerErrorCode,
} from "@/domain/operations/customer-errors";
import { confirmedCustomerContext } from "@/domain/operations/confirmed-customer";
import { uuid } from "@/domain/inventory/validation";
export async function fetchCustomerContext(
  trip: string,
  customer: string,
  signal?: AbortSignal,
) {
  let response: Response;
  try {
    response = await fetch(
      `/api/driver/customers/${encodeURIComponent(customer)}/context?trip=${encodeURIComponent(trip)}`,
      { credentials: "same-origin", cache: "no-store", signal },
    );
  } catch (error) {
    if (signal?.aborted) {
      if (signal.reason?.name === "TimeoutError")
        throw new CustomerLookupError("TEMPORARY", 503);
      // Superseded/unmounted lookups are cancellation, not disconnection.
      throw error;
    }
    throw new CustomerLookupError("NETWORK", 0);
  }
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    const code = result?.code as CustomerErrorCode;
    throw new CustomerLookupError(
      Object.hasOwn(customerErrorMessages, code)
        ? code
        : response.status === 401
          ? "AUTHENTICATION"
          : response.status === 403
            ? "AUTHORIZATION"
            : "TEMPORARY",
      response.status,
    );
  }
  if (!result || result.trip !== trip)
    throw new CustomerLookupError("SCHEMA", 503);
  let user: string;
  try {
    user = uuid(result.user);
  } catch {
    throw new CustomerLookupError("SCHEMA", 503);
  }
  const data = confirmedCustomerContext(result.data, customer);
  return { data, user, trip };
}
// Unlocked offline tabs refresh the complete receipt-covered snapshot. Never
// overwrite encrypted balances with a partial customer response or store a key.
export function notifyConfirmedCustomer(user: string, trip: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("mk-customer-confirmed", { detail: { user, trip } }),
  );
  if (typeof BroadcastChannel !== "undefined") {
    const channel = new BroadcastChannel("mk-customer-confirmed");
    channel.postMessage({ user, trip });
    channel.close();
  }
}
