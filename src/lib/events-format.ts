// Reine, framework-unabhängige Event-Helfer (Typen, Gruppierung, Formatierung).
// KEIN Server-Import -> darf in Client-Components genutzt werden (Filter-Pills
// gruppieren nach dem Filtern clientseitig neu). Zeitzone durchgehend Europa/Wien.

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
