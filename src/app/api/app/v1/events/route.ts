import { appError, appFailure, appGuard, appJson } from "@/lib/app-api";
import type { AppEvents } from "@/lib/app-api-types";
import { getUpcomingEvents } from "@/lib/events";
import { eventsInRange, lastEventDay, viennaDayKey } from "@/lib/events-format";

export const runtime = "nodejs";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function validDay(v: string): boolean {
  if (!DAY.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(v);
}

/**
 * Kommende Events, dieselbe Funktion wie die Webseite /events (getUpcomingEvents: veröffentlicht,
 * Auto-Ablauf). Für alle gleich, Anmeldung optional. Optional `?from=&to=` (Wiener Kalendertage,
 * YYYY-MM-DD, beide oder keiner): dann nur Events, die sich mit dem Zeitraum überschneiden
 * (eventsInRange wie die Datumsauswahl im Web).
 */
export async function GET(req: Request) {
  const ctx = await appGuard(req);
  if (ctx instanceof Response) return ctx;
  try {
    const q = new URL(req.url).searchParams;
    const from = q.get("from");
    const to = q.get("to");
    if ((from === null) !== (to === null)) return appError("invalid", 400);
    if (from !== null && to !== null && (!validDay(from) || !validDay(to) || from > to)) {
      return appError("invalid", 400);
    }

    const all = await getUpcomingEvents(ctx.lang);
    const todayKey = viennaDayKey(new Date().toISOString());
    const events = from !== null && to !== null ? eventsInRange(all, { from, to }) : all;
    const body: AppEvents = {
      lang: ctx.lang,
      todayKey,
      // Ende des auswählbaren Kalenders, immer über ALLE kommenden Events (nicht über den Filter).
      maxDay: lastEventDay(all, todayKey),
      events,
    };
    return appJson(body, "private-5min");
  } catch (e) {
    return appFailure(req, e);
  }
}
