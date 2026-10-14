import { createClient } from "@/lib/supabase/server";
import { readCurrentProfile } from "@/data-access/profiles";
import { can } from "@/domain/auth/roles";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
async function authorized() {
  const profile = await readCurrentProfile();
  return profile && can(profile, "driver:read");
}
function failure(error: { code?: string } | null) {
  return Response.json(
    { message: "Notifications could not be synchronized. Try again." },
    {
      status: error?.code === "42501" ? 403 : 503,
      headers,
    },
  );
}
export async function GET(request: Request) {
  try {
    if (!(await authorized()))
      return Response.json({}, { status: 401, headers });
    const before = new URL(request.url).searchParams.get("before");
    if (before !== null && !/^[1-9]\d{0,14}$/.test(before))
      return Response.json({}, { status: 400, headers });
    const { data, error } = await (
      await createClient()
    ).rpc("notification_feed", {
      p_before: before === null ? null : Number(before),
    });
    return error ? failure(error) : Response.json(data, { headers });
  } catch {
    return failure(null);
  }
}
export async function POST(request: Request) {
  const origin = new URL(request.url);
  origin.host = request.headers.get("host") ?? origin.host;
  if (request.headers.get("origin") !== origin.origin)
    return Response.json({}, { status: 403, headers });
  try {
    if (!(await authorized()))
      return Response.json({}, { status: 401, headers });
    const text = await request.text();
    if (text.length > 12000) return Response.json({}, { status: 413, headers });
    const body = JSON.parse(text);
    if (
      !body ||
      typeof body !== "object" ||
      !Array.isArray(body.ids) ||
      body.ids.length > 200 ||
      body.ids.some(
        (id: unknown) => typeof id !== "string" || !uuid.test(id),
      ) ||
      typeof body.all !== "boolean" ||
      (body.all && (!Number.isSafeInteger(body.through) || body.through < 1))
    )
      return Response.json({}, { status: 400, headers });
    const { error } = await (
      await createClient()
    ).rpc("notification_read", {
      p_ids: body.ids,
      p_all: body.all,
      p_through: body.all ? body.through : null,
    });
    return error ? failure(error) : Response.json({ saved: true }, { headers });
  } catch {
    return failure(null);
  }
}
