import { OfflineServerError } from "@/data-access/offline";
import { CustomerLookupError } from "@/domain/operations/customer-errors";
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
export function failure(error: unknown) {
  if (
    error instanceof OfflineServerError ||
    error instanceof CustomerLookupError
  )
    return Response.json(
      { code: error.code, message: error.message },
      { status: error.status, headers },
    );
  if (
    error instanceof SyntaxError ||
    (error instanceof Error &&
      [
        "Invalid offline record.",
        "Invalid record or request identifier.",
      ].includes(error.message))
  )
    return Response.json(
      { code: "INVALID", message: "Invalid offline record." },
      { status: 400, headers },
    );
  return Response.json(
    {
      code: "TEMPORARY",
      message: "The server could not be reached. Saved records will retry.",
    },
    { status: 503, headers },
  );
}
