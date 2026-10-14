import { readCurrentProfile } from "@/data-access/profiles";
import { can } from "@/domain/auth/roles";
import { readInstantHistory } from "@/data-access/instant";
import { uuid } from "@/domain/inventory/validation";
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
  try {
    if (!can(await readCurrentProfile(), "driver:read"))
      return Response.json({}, { status: 401, headers });
    return Response.json(
      await readInstantHistory(uuid((await context.params).id)),
      { headers },
    );
  } catch {
    return Response.json(
      {
        message: "Instant delivery history could not be loaded. Please retry.",
      },
      { status: 503, headers },
    );
  }
}
