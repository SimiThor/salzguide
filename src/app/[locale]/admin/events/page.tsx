import { Link } from "@/i18n/navigation";
import { getAdminEvents, getResearchLog } from "@/lib/events";
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
  const [events, log] = await Promise.all([getAdminEvents(), getResearchLog()]);
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

      <AdminEventList events={events} />
    </div>
  );
}
