import { offlineCommand, offlineCurrent } from "@/services/offline";
import { failure } from "@/lib/offline/server-response";
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
export async function GET() {
  try {
    return Response.json(await offlineCurrent(), { headers });
  } catch (error) {
    return failure(error);
  }
}
export async function POST(request: Request) {
  const origin = new URL(request.url);
  origin.host = request.headers.get("host") ?? origin.host;
  if (request.headers.get("origin") !== origin.origin)
    return Response.json(
      { code: "AUTHORIZATION", message: "Cross-origin request denied." },
      { status: 403, headers },
    );
  if (Number(request.headers.get("content-length")) > 150000)
    return Response.json({ code: "INVALID" }, { status: 413, headers });
  try {
    const text = await request.text();
    if (text.length > 150000) throw new Error("Invalid offline record.");
    const body: unknown = JSON.parse(text);
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new Error("Invalid offline record.");
    return Response.json(
      await offlineCommand(body as Record<string, unknown>),
      { headers },
    );
  } catch (error) {
    return failure(error);
  }
}
