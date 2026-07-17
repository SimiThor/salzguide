import { Link } from "@/i18n/navigation";
import { getAdminEvents, getResearchLog } from "@/lib/events";
import { getAdminAnchors } from "@/lib/anchors";
import { viennaWeekWindow } from "@/lib/events-format";
import AdminNav from "@/components/admin/AdminNav";
import AdminEventList from "@/components/admin/AdminEventList";
import BulkTranslateButton from "@/components/admin/BulkTranslateButton";
import WeeklyResearchPanel, {
  type WeekInfo,
} from "@/components/admin/WeeklyResearchPanel";

// Die KI-Wochenrecherche (Server-Action von hier) recherchiert + übersetzt gleich in alle
// Sprachen -> kann etwas dauern. Großzügiges Zeitlimit (Vercel Pro: bis 300s).
export const maxDuration = 300;

const weekFmt = new Intl.DateTimeFormat("de-AT", {
  timeZone: "Europe/Vienna",
  day: "2-digit",
  month: "2-digit",
});
const doneFmt = new Intl.DateTimeFormat("de-AT", {
  timeZone: "Europe/Vienna",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

export default async function AdminEventsPage() {
  const [events, log, anchors] = await Promise.all([
    getAdminEvents(),
    getResearchLog(),
    getAdminAnchors(),
  ]);
  const activeAnchors = anchors.filter((a) => a.active).length;
  // Noch nicht vollständig übersetzte, kommende Events (Sammel-Übersetzen). Vergangene braucht
  // niemand mehr zu übersetzen.
  const incompleteEvents = events
    .filter((e) => !e.isPast && e.trState !== "complete")
    .map((e) => ({ id: e.id, label: e.title }));

  // 3 Kalenderwochen (aktuell/nächste/übernächste) + Log-Status berechnen.
  const now = new Date();
  const logMap = new Map(log.map((l) => [l.weekStart, l]));
  const weeks: WeekInfo[] = [0, 1, 2].map((offset) => {
    const w = viennaWeekWindow(now, offset);
    const l = logMap.get(w.mondayKey);
    const label = `${weekFmt.format(new Date(`${w.mondayKey}T12:00:00Z`))}–${weekFmt.format(new Date(`${w.sundayKey}T12:00:00Z`))}`;
    return {
      offset,
      label,
      researchedLabel: l ? doneFmt.format(new Date(l.researchedAt)) : null,
      inserted: l?.inserted ?? null,
    };
  });

  return (
    <div className="space-y-4 pb-12">
      <AdminNav active="events" />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-ink">Admin · Events</h1>
        <div className="flex flex-wrap items-center gap-2">
          <BulkTranslateButton kind="event" items={incompleteEvents} noun="Events" />
          <Link
            href="/admin/events/new"
            className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white active:scale-[0.98]"
          >
            + Neues Event
          </Link>
        </div>
      </div>

      <WeeklyResearchPanel weeks={weeks} />

      {/* Direkt unter der Recherche, weil die Anker genau deren Zutat sind: Die KI wird bei
          JEDER Wochenrecherche an sie erinnert. Als eigener Reiter standen sie oben und
          kosteten bei jedem Blick Aufmerksamkeit, obwohl man sie zweimal im Jahr anfasst.

          Die Zahlen stehen MIT auf der Kachel, nicht erst dahinter: „Wie viele sind aktiv?"
          ist die einzige Frage, die man von aussen stellt — muss man dafür hineinklicken,
          klickt man jedes Mal umsonst. Gleiches Muster wie Einstellungen -> Startseite. */}
      <Link
        href="/admin/events/anchors"
        className="flex items-center gap-4 rounded-[18px] bg-white p-5 shadow-sm ring-1 ring-black/5 transition hover:ring-black/15 active:scale-[0.995]"
      >
        <span className="text-[22px]" aria-hidden>
          📌
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-[17px] font-bold text-ink">Jahres-Events (Anker)</span>
            <span className="rounded-full bg-black/5 px-2 py-0.5 text-[11px] font-semibold text-muted">
              {activeAnchors} aktiv
            </span>
          </span>
          <span className="mt-1 block text-[13px] leading-relaxed text-muted">
            Bekannte jährliche Highlights, an die die KI bei jeder Wochenrecherche erinnert
            wird.
          </span>
        </span>
        <span className="shrink-0 text-[18px] text-muted" aria-hidden>
          ›
        </span>
      </Link>

      <AdminEventList events={events} />
    </div>
  );
}
