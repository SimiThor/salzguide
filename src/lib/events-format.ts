// Reine, framework-unabhängige Event-Helfer (Typen, Gruppierung, Formatierung).
// KEIN Server-Import -> darf in Client-Components genutzt werden (Filter-Pills
// gruppieren nach dem Filtern clientseitig neu). Zeitzone durchgehend Europa/Wien.

import { bcp47 } from "@/i18n/locales";
import { shiftDay } from "./vienna-day";

export type EventCategory = "party" | "tradition" | "kultur" | "sport" | "kids";
export const EVENT_CATEGORIES: EventCategory[] = [
  "party",
  "tradition",
  "kultur",
  "sport",
  "kids",
];

// Deutsche Kategorie-Labels fürs Admin-UI. EINE typisierte Quelle -> eine neue
// Kategorie erzwingt hier automatisch ein Label (kein „vergessenes Label"-Bug).
// (Die öffentliche App nutzt i18n `Events.cat.*` für DE/EN.)
export const CATEGORY_LABEL: Record<EventCategory, string> = {
  party: "Party",
  tradition: "Tradition",
  kultur: "Kultur",
  sport: "Sport",
  kids: "Kids",
};

export type EventItem = {
  id: string;
  title: string;
  description: string | null;
  emoji: string | null;
  startsAt: string; // ISO (UTC)
  endsAt: string | null; // ISO (UTC)
  allDay: boolean;
  locationName: string | null;
  category: EventCategory;
  isHighlight: boolean;
  isFree: boolean; // gratis Eintritt -> „Gratis"-Filter/Badge
  sourceUrl: string | null;
  imageUrl: string | null;
};

// Ein Tag der Wochenansicht (Events nach Tag gruppiert).
export type EventDay = {
  key: string; // YYYY-MM-DD (Wiener Kalendertag)
  events: EventItem[];
};

const TZ = "Europe/Vienna";

// Offset (ms) der Zone zu UTC am gegebenen Zeitpunkt – DST-sicher via Intl.
export function tzOffsetMs(date: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const p = Object.fromEntries(
    dtf.formatToParts(date).map((x) => [x.type, x.value]),
  ) as Record<string, string>;
  const hour = p.hour === "24" ? 0 : Number(p.hour);
  const asUTC = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    hour,
    Number(p.minute),
    Number(p.second),
  );
  return asUTC - date.getTime();
}

// ISO-Zeitpunkt für Mitternacht (Beginn) des Wiener Kalendertags von `now`.
export function startOfViennaDayIso(now: Date): string {
  const off = tzOffsetMs(now);
  const wall = new Date(now.getTime() + off);
  const midnightWall = Date.UTC(
    wall.getUTCFullYear(),
    wall.getUTCMonth(),
    wall.getUTCDate(),
    0,
    0,
    0,
  );
  return new Date(midnightWall - off).toISOString();
}

// Formular <input type="datetime-local"> ("YYYY-MM-DDTHH:mm") -> UTC-ISO.
// Der Wert wird als WIENER Wandzeit interpretiert (geräte-Zeitzone egal) -> robust.
export function viennaWallToUtcIso(local: string): string | null {
  const m = local.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return null;
  const y = +m[1],
    mo = +m[2],
    d = +m[3],
    h = +m[4],
    mi = +m[5];
  const guess = Date.UTC(y, mo - 1, d, h, mi); // Wandzeit fälschlich als UTC
  const off = tzOffsetMs(new Date(guess)); // Offset an diesem Zeitpunkt
  return new Date(guess - off).toISOString();
}

// UTC-ISO -> "YYYY-MM-DDTHH:mm" in Wiener Wandzeit (Vorbelegung datetime-local).
export function utcIsoToViennaWall(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(iso));
  const p = Object.fromEntries(
    parts.map((x) => [x.type, x.value]),
  ) as Record<string, string>;
  const hh = p.hour === "24" ? "00" : p.hour;
  return `${p.year}-${p.month}-${p.day}T${hh}:${p.minute}`;
}

// Wiener Kalendertag (YYYY-MM-DD) eines ISO-Zeitpunkts – Gruppierungsschlüssel.
export function viennaDayKey(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

const DAY_MS = 86400000;

// Feste Kalenderwoche (Montag–Sonntag) in Wiener Zeit für `now` + weekOffset
// (0 = aktuelle, 1 = nächste, 2 = übernächste Woche).
// mondayKey/sundayKey = Datumsschlüssel; startIso (inkl.) .. endIso (exkl.) = UTC-Grenzen.
export function viennaWeekWindow(
  now: Date,
  weekOffset: number,
): { mondayKey: string; sundayKey: string; startIso: string; endIso: string } {
  const key = viennaDayKey(now.toISOString());
  const noon = new Date(`${key}T12:00:00Z`); // Mittag -> Zonenrand-sicher
  const isoDow = noon.getUTCDay() === 0 ? 7 : noon.getUTCDay(); // Mo=1..So=7
  const mondayMs = noon.getTime() - (isoDow - 1) * DAY_MS + weekOffset * 7 * DAY_MS;
  const mondayKey = viennaDayKey(new Date(mondayMs).toISOString());
  const sundayKey = viennaDayKey(new Date(mondayMs + 6 * DAY_MS).toISOString());
  const nextMondayKey = viennaDayKey(new Date(mondayMs + 7 * DAY_MS).toISOString());
  return {
    mondayKey,
    sundayKey,
    startIso: viennaWallToUtcIso(`${mondayKey}T00:00`)!,
    endIso: viennaWallToUtcIso(`${nextMondayKey}T00:00`)!,
  };
}

// Events nach Wiener Kalendertag gruppieren (Reihenfolge = chronologisch).
// Die Liste beginnt IMMER bei heute: Ein mehrtägiges Event, das früher begonnen
// hat, läuft ja noch (der Server filtert Vorbeies weg) -> es kommt unter „heute"
// statt unter seinen Start-Tag. Sonst stünde eine vergangene Tages-Überschrift
// über der Liste.
export function groupByDay(events: EventItem[], todayKey: string): EventDay[] {
  const map = new Map<string, EventItem[]>();
  for (const e of events) {
    const start = viennaDayKey(e.startsAt);
    const key = start < todayKey ? todayKey : start;
    const arr = map.get(key);
    if (arr) arr.push(e);
    else map.set(key, [e]);
  }
  return [...map.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([key, evs]) => ({ key, events: evs }));
}

// Tages-Label aus dem Key: Wochentag + Datum, lokalisiert.
// z.B. de: { weekday: "Montag", date: "15. Juni" } · en: { weekday: "Monday", date: "June 15" }
export function dayLabel(
  key: string,
  locale: string,
): { weekday: string; date: string } {
  const d = new Date(`${key}T12:00:00Z`); // Mittag -> Zonenrand-sicher
  const weekday = new Intl.DateTimeFormat(locale, {
    timeZone: TZ,
    weekday: "long",
  }).format(d);
  const date = new Intl.DateTimeFormat(locale, {
    timeZone: TZ,
    day: "numeric",
    month: "long",
  }).format(d);
  return { weekday, date };
}

// Uhrzeit-Label eines Events (lokal, Wien). Ganztägig -> null (Aufrufer zeigt Badge).
export function eventTimeLabel(e: EventItem, locale: string): string | null {
  if (e.allDay) return null;
  const fmt = new Intl.DateTimeFormat(locale, {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
  });
  const start = fmt.format(new Date(e.startsAt));
  if (e.endsAt) {
    // Endzeit nur zeigen, wenn am selben Kalendertag (sonst nur Startzeit).
    if (viennaDayKey(e.endsAt) === viennaDayKey(e.startsAt)) {
      return `${start} – ${fmt.format(new Date(e.endsAt))}`;
    }
  }
  return start;
}

// Ist der Wiener Kalendertag `key` gleich heute (in Wien)?
export function isToday(key: string, now: Date): boolean {
  return key === viennaDayKey(now.toISOString());
}

// ─── Zeitraum-Auswahl ─────────────────────────────────────────────────────────
//
// Wer wissen will, ob am Donnerstag etwas los ist, soll nicht drei Wochen Liste durchsehen.
// Alles hier rechnet in Wiener Kalendertagen; die Auswahl selbst steht in DateRangeSheet.tsx.

/** Ein gewählter Zeitraum. Ein einzelner Tag ist `from === to` — kein Sonderfall. */
export type DayRange = { from: string; to: string };

// Ein Event, das um 02:00 endet, gehört zum ABEND DAVOR und nicht zum nächsten Morgen.
// Ohne diese Grenze stünde die Freitags-Party unter „Samstag", sobald jemand nur den
// Samstag auswählt — mit „20:00" in der Zeile darunter. Fünf Uhr, weil davor niemand ein
// Event beginnt: Was um 03:00 noch läuft, ist die Nacht davor, was um 06:00 anfängt, ist
// der Sonnenaufgangs-Ausflug. Ganztägige Events sind ausgenommen, die haben keine Uhrzeit.
const NIGHT_END_HOUR = 5;

const HOUR_FMT = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ,
  hour: "2-digit",
  hour12: false,
});

function viennaHour(iso: string): number {
  const h = Number(HOUR_FMT.format(new Date(iso)));
  return Number.isFinite(h) ? h % 24 : 12; // "24" ist Mitternacht (siehe tzOffsetMs)
}

/** Erster und letzter Wiener Kalendertag, an dem ein Event stattfindet. */
export function eventDaySpan(e: EventItem): { first: string; last: string } {
  const first = viennaDayKey(e.startsAt);
  if (!e.endsAt) return { first, last: first };
  let last = viennaDayKey(e.endsAt);
  if (!e.allDay && viennaHour(e.endsAt) < NIGHT_END_HOUR) last = shiftDay(last, -1);
  return { first, last: last < first ? first : last };
}

/**
 * Events, die im Zeitraum stattfinden. Entscheidend ist die ÜBERSCHNEIDUNG, nicht der
 * Starttag: Ein Festival vom 12. bis 20. läuft auch am 15., und wer den 15. auswählt,
 * will es sehen. (Die Liste zeigt es dann unter dem 15. — groupByDay bekommt dafür den
 * Zeitraum-Anfang als Klammer statt „heute".)
 */
export function eventsInRange(
  events: EventItem[],
  range: DayRange | null,
): EventItem[] {
  if (!range) return events;
  return events.filter((e) => {
    const { first, last } = eventDaySpan(e);
    return first <= range.to && last >= range.from;
  });
}

/**
 * Wie viele Events an welchem Tag laufen — die Punkte unter den Zahlen im Kalender.
 * Mehrtägige Events zählen an JEDEM ihrer Tage, sonst stünde ein Festival-Tag leer da.
 */
export function eventDayCounts(
  events: EventItem[],
  todayKey: string,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const e of events) {
    const { first, last } = eventDaySpan(e);
    let day = first < todayKey ? todayKey : first;
    // Deckel: ein Dauer-Event mit kaputtem Enddatum darf den Render nicht anhalten.
    for (let i = 0; day <= last && i < 400; i++) {
      out.set(day, (out.get(day) ?? 0) + 1);
      day = shiftDay(day, 1);
    }
  }
  return out;
}

/** Letzter Tag, an dem überhaupt etwas läuft = das Ende des auswählbaren Kalenders. */
export function lastEventDay(events: EventItem[], todayKey: string): string {
  let last = todayKey;
  for (const e of events) {
    const end = eventDaySpan(e).last;
    if (end > last) last = end;
  }
  return last;
}

/**
 * Beschriftung eines Zeitraums für die Pille über der Liste: „15. August" für einen Tag,
 * „15.–20. August" für eine Spanne.
 *
 * formatRange() zieht Gleiches selbst zusammen (der Monat steht nur einmal da) und setzt
 * das Trennzeichen so, wie es die jeweilige Sprache erwartet — von Hand zusammengebaut
 * wäre das in dreizehn Sprachen dreizehn Mal falsch. Es liefert einen Halbgeviertstrich,
 * KEINEN Gedankenstrich; der ist in dieser App verboten.
 *
 * ACHTUNG, DER PREIS DAFÜR: Das Ergebnis darf nicht in vorgerenderten Text geraten, den der
 * Browser danach hydriert. Die Spannen-Muster sind der eine Teil der ICU-Daten, bei dem Node
 * und Chrome auseinanderliegen — nachgemessen am 11.08.2026: en „11 – 30 August" (Server)
 * gegen „11–30 August" (Browser), sk unterscheidet sich sogar nur in einem unsichtbaren
 * Leerzeichen. Beides kostet die Hydration der ganzen Seite. Deshalb formatiert
 * events/page.tsx die Ausgangs-Beschriftung SERVERSEITIG und reicht sie als Prop durch;
 * im Client läuft das hier erst, wenn jemand wirklich einen Zeitraum gewählt hat.
 */
export function rangeLabel(range: DayRange, locale: string): string {
  const fmt = new Intl.DateTimeFormat(bcp47(locale), {
    timeZone: TZ,
    day: "numeric",
    month: "long",
  });
  const from = new Date(`${range.from}T12:00:00Z`); // Mittag -> Zonenrand-sicher
  if (range.from === range.to) return fmt.format(from);
  return fmt.formatRange(from, new Date(`${range.to}T12:00:00Z`));
}
