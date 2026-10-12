import { cookies } from "next/headers";
import { requireIdentity } from "@/services/auth";
import { createClient } from "@/lib/supabase/server";
import { isLocale } from "@/domain/localization/locale";
export async function POST(request: Request) {
  // Identity and role continue to come exclusively from the protected profile.
  // Supabase Auth metadata is a display preference, never authorization input.
  // Next dev may use localhost in Request.url while the browser uses 127.0.0.1.
  // Host is the address the browser requested; reject cross-origin writes.
  const origin = new URL(request.url);
  origin.host = request.headers.get("host") ?? origin.host;
  if (request.headers.get("origin") !== origin.origin)
    return new Response(null, { status: 403 });
  await requireIdentity();
  const body: unknown = await request.json().catch(() => null);
  const locale =
    body && typeof body === "object" && "locale" in body ? body.locale : null;
  if (!isLocale(locale)) return new Response(null, { status: 400 });
  const { error } = await (
    await createClient()
  ).auth.updateUser({ data: { locale } });
  if (error)
    return Response.json(
      { saved: false },
      { status: 503, headers: { "Cache-Control": "private, no-store" } },
    );
  (await cookies()).set("mk-locale", locale, {
    // This public display cookie also allows the anonymous sign-in switcher.
    // The authenticated user's Auth metadata remains authoritative.
    httpOnly: false,
    sameSite: "lax",
    secure: new URL(request.url).protocol === "https:",
    path: "/",
    maxAge: 31536000,
  });
  return Response.json(
    { saved: true },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
