import { offlineIdentity } from "@/services/offline";
import { getDriverWorkspace } from "@/services/driver-workspace";
import { getPendingJars } from "@/services/pending-jars";
import { getTripHistory } from "@/services/history";
import { readOfflineRound } from "@/data-access/offline";
import { getLocale } from "@/lib/i18n/server";
import { failure } from "@/lib/offline/server-response";
import { readInstantWorkspace } from "@/data-access/instant";
export async function GET(request: Request) {
  const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
  try {
    const profile = await offlineIdentity();
    const q = new URL(request.url).searchParams;
    const data = await getDriverWorkspace(q.get("trip") ?? undefined);
    const [round, pending, history, locale] = await Promise.all([
      data.trip ? readOfflineRound(data.trip.id) : null,
      getPendingJars(false, undefined, q.get("customer") ?? undefined),
      getTripHistory(
        q.get("from") ?? undefined,
        q.get("to") ?? undefined,
        false,
      ),
      getLocale(profile),
    ]);
    return Response.json(
      {
        ...data,
        profile,
        round,
        pending,
        history,
        locale,
        instant: await readInstantWorkspace(),
      },
      { headers },
    );
  } catch (error) {
    return failure(error);
  }
}
