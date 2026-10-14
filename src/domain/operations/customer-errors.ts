export type CustomerErrorCode =
  | "NETWORK"
  | "AUTHENTICATION"
  | "AUTHORIZATION"
  | "NOT_FOUND"
  | "SCHEMA"
  | "TEMPORARY"
  | "CONFLICT"
  | "INVALID";
export const customerErrorMessages: Record<CustomerErrorCode, string> = {
  NETWORK:
    "Network unavailable. Unlock your prepared device records; your draft is preserved.",
  AUTHENTICATION:
    "Your session expired. Sign in online again; your draft is preserved.",
  AUTHORIZATION:
    "You do not have access to this customer or delivery round. Contact the admin.",
  NOT_FOUND:
    "Customer was not found or is inactive. Refresh the customer directory.",
  SCHEMA:
    "Customer lookup requires a database update. Contact the admin; your draft is preserved.",
  TEMPORARY:
    "Customer details are temporarily unavailable. Retry; your draft is preserved.",
  CONFLICT:
    "Customer data changed. Refresh the confirmed details and review this delivery.",
  INVALID: "Select a valid customer and delivery round.",
};
export class CustomerLookupError extends Error {
  constructor(
    public code: CustomerErrorCode,
    public status: number,
  ) {
    super(customerErrorMessages[code]);
  }
}
export function customerDatabaseError(
  error: { code?: string; message?: string },
  status?: number,
) {
  const code = error.code ?? "";
  if (
    ["PGRST301", "PGRST302", "PGRST303", "28000", "28P01"].includes(code) ||
    status === 401
  )
    return new CustomerLookupError("AUTHENTICATION", 401);
  if (
    [
      "25006",
      "42P01",
      "42703",
      "42883",
      "PGRST202",
      "PGRST204",
      "PGRST205",
    ].includes(code)
  )
    return new CustomerLookupError("SCHEMA", 503);
  if (code === "42501" || status === 403)
    return new CustomerLookupError("AUTHORIZATION", 403);
  if (
    code === "22023" &&
    /Customer is missing or inactive/i.test(error.message ?? "")
  )
    return new CustomerLookupError("NOT_FOUND", 404);
  if (code === "22023") return new CustomerLookupError("CONFLICT", 409);
  if (["40001", "40P01"].includes(code))
    return new CustomerLookupError("TEMPORARY", 503);
  return new CustomerLookupError(
    status === 0 ||
      /fetch failed|Failed to fetch|network/i.test(error.message ?? "")
      ? "NETWORK"
      : "TEMPORARY",
    503,
  );
}
