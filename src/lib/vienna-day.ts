// ═══════════════════════════════════════════════════════════════════════════════════════
//  Der Kalender der Auswertung: Wiener Tage, an EINER Stelle gerechnet.
// ═══════════════════════════════════════════════════════════════════════════════════════
//
// WARUM ES DIESE DATEI GIBT. Jede Analytics-Abfrage gruppiert nach
// `created_at at time zone 'Europe/Vienna'`, der Besucher-Salt rotiert nach Wiener Tag, und
// das Dashboard zeigt Wiener Datumsangaben. Der ZEITRAUM dagegen wurde bis 07/2026 in UTC
// gebildet: `${von}T00:00:00.000Z`. Im Sommer ist das 02:00 Wiener Zeit.
//
// Ein „Juli"-Bericht begann also am 1. Juli um 02:00 und endete am 1. August um 01:59 — die
// ersten beiden Stunden des Monats fehlten, die ersten beiden des Folgemonats waren drin.
// Zwei Stunden an jedem Rand klingen nach nichts, aber sie fallen genau in die Zeit, in der
// Reise-Inhalte gelesen werden: abends. Und weil die Zeitreihe nach Wiener Tag gruppiert,
// erschien der erste Balken jeder Auswertung systematisch zu niedrig.
//
// Pure Kalender-Rechnung, keine Abhängigkeiten. Alle Tage sind Strings „YYYY-MM-DD"; die
// vergleichen sich lexikografisch richtig, solange das Format fix ist.

const TZ = "Europe/Vienna";
const DAY_MS = 86_400_000;

const DAY_FMT = new Intl.DateTimeFormat("en-CA", { timeZone: TZ });
const OFFSET_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ,
  timeZoneName: "longOffset",
});

/** Der Wiener Kalendertag eines Zeitpunkts, „YYYY-MM-DD". */
export function viennaDay(at: Date = new Date()): string {
  return DAY_FMT.format(at);
}

/** Abstand der Wiener Zeit zu UTC in Minuten, zu einem bestimmten Zeitpunkt (+60 / +120). */
function offsetMinutes(at: Date): number {
  // "GMT+02:00" — `longOffset` ist seit ES2022 überall da, wo diese App läuft.
  const m = OFFSET_FMT.format(at).match(/GMT([+-])(\d{2}):(\d{2})/);
  if (!m) return 0;
  return (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
}

/**
 * Mitternacht eines Wiener Kalendertags, als echter Zeitpunkt (UTC).
 *
 * Der Trick mit den zwei Durchgängen ist NÖTIG, nicht vorsichtshalber: An den beiden
 * Umstellungstagen im Jahr gilt um Mitternacht ein anderer Abstand zu UTC als um Mittag.
 * Der erste Durchgang fragt bei Mittag (dort liegt garantiert kein Wechsel), der zweite
 * fragt an dem so gefundenen Zeitpunkt nach und zieht nach, falls er danebenlag.
 *
 * Beispiel 29.03.2026 (Beginn der Sommerzeit): Mittag sagt +2, das ergäbe 28.03. 22:00 UTC —
 * dort gilt aber noch +1, also ist Mitternacht in Wahrheit 28.03. 23:00 UTC. Ein Nachziehen
 * genügt immer: Keine Umstellung verschiebt mehr als eine Stunde.
 */
export function viennaDayStart(day: string): Date {
  const base = Date.parse(`${day}T00:00:00.000Z`);
  const noon = offsetMinutes(new Date(base + 12 * 3_600_000));
  const first = base - noon * 60_000;
  const actual = offsetMinutes(new Date(first));
  return new Date(actual === noon ? first : base - actual * 60_000);
}

/** Mitternacht des FOLGETAGS — die obere, ausschliessende Grenze eines Tages. */
export function viennaDayEnd(day: string): Date {
  return viennaDayStart(shiftDay(day, 1));
}

/** Kalendertag verschieben („2026-07-31", 1) -> „2026-08-01". Reine Datums-Arithmetik. */
export function shiftDay(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + days * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

/** Wie viele Kalendertage der Zeitraum umfasst, beide Enden eingeschlossen. */
export function dayCount(fromDay: string, toDay: string): number {
  return Math.max(
    1,
    Math.round((Date.parse(`${toDay}T00:00:00.000Z`) - Date.parse(`${fromDay}T00:00:00.000Z`)) / DAY_MS) + 1,
  );
}

export type Bucket = "day" | "week" | "month";

/**
 * Anfang des Balkens, in dem ein Tag liegt — GLEICH gerechnet wie `date_trunc` in Postgres,
 * denn genau diese Werte kommen aus `analytics_timeseries` zurück und müssen zusammenpassen.
 * Postgres' Woche beginnt am Montag (ISO-8601), deshalb hier auch.
 */
export function bucketStart(day: string, bucket: Bucket): string {
  if (bucket === "month") return `${day.slice(0, 7)}-01`;
  if (bucket === "day") return day;
  const dow = new Date(`${day}T00:00:00.000Z`).getUTCDay(); // 0 = Sonntag
  return shiftDay(day, -((dow + 6) % 7));
}

/** Der Anfang des NÄCHSTEN Balkens. */
function nextBucket(start: string, bucket: Bucket): string {
  if (bucket !== "month") return shiftDay(start, bucket === "week" ? 7 : 1);
  const year = Number(start.slice(0, 4));
  const month = Number(start.slice(5, 7)); // 1–12
  return month === 12
    ? `${year + 1}-01-01`
    : `${year}-${String(month + 1).padStart(2, "0")}-01`;
}

/** Alle Balken-Anfänge eines Zeitraums, lückenlos und in Reihenfolge. */
export function bucketRange(fromDay: string, toDay: string, bucket: Bucket): string[] {
  const out: string[] = [];
  const last = bucketStart(toDay, bucket);
  let cur = bucketStart(fromDay, bucket);
  // Deckel gegen eine Endlosschleife bei absurden Eingaben (Tagesbalken sind der dichteste
  // Fall; mehr als ein paar Jahre zeigt das Dashboard ohnehin nie).
  for (let i = 0; cur <= last && i < 4000; i++) {
    out.push(cur);
    cur = nextBucket(cur, bucket);
  }
  return out;
}
