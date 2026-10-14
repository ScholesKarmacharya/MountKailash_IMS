import { readCurrentProfile } from "@/data-access/profiles";
import { can } from "@/domain/auth/roles";
import { readDeliveryCustomer } from "@/data-access/operations";
import { CustomerLookupError } from "@/domain/operations/customer-errors";
import { uuid } from "@/domain/inventory/validation";
import { ProfileAccessError } from "@/domain/auth/access-errors";
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const profile = await readCurrentProfile();
    if (!profile) throw new CustomerLookupError("AUTHENTICATION", 401);
    if (!can(profile, "customer:operate"))
      throw new CustomerLookupError("AUTHORIZATION", 403);
    let customer: string, trip: string;
    try {
      customer = uuid((await params).id);
      trip = uuid(new URL(request.url).searchParams.get("trip") ?? "");
    } catch {
      throw new CustomerLookupError("INVALID", 400);
    }
    return Response.json(
      {
        data: await readDeliveryCustomer(trip, customer),
        user: profile.id,
        trip,
      },
      { headers },
    );
  } catch (error) {
    const failure =
      error instanceof CustomerLookupError
        ? error
        : error instanceof ProfileAccessError
          ? new CustomerLookupError(error.code, 503)
          : new CustomerLookupError("TEMPORARY", 503);
    return Response.json(
      { code: failure.code, message: failure.message },
      { status: failure.status, headers },
    );
  }
}
