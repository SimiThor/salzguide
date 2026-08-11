// Monats-Raster, rein gerechnet. Keine Zeitzone, keine Sprache, kein React.
//
// WARUM SEPARAT: Die Datumsauswahl auf /events zeichnet ein Monatsgitter. Diese Rechnung —
// „auf welchen Wochentag fällt der Erste, wie viele Tage hat der Monat" — ist die eine
// Stelle, an der ein Datums-Bug lautlos entsteht: Ein Monat mit einem Feld Versatz sieht
// vollkommen normal aus, bis jemand den falschen Tag antippt.
//
// Alle Tage sind Strings „YYYY-MM-DD", alle Monate „YYYY-MM". Beide vergleichen sich
// lexikografisch richtig, solange das Format fix ist (dieselbe Regel wie in vienna-day.ts).
//
// Gerechnet wird durchgehend in UTC (Date.UTC / getUTC*): Ein Kalendertag ist hier ein
// LABEL, kein Zeitpunkt. Wer `new Date("2026-08-01")` in einer Zeitzone westlich von
// Greenwich auf `getDate()` loslässt, bekommt den 31. Juli zurück — genau der Fehler, den
// diese Datei ausschliesst. Die Umrechnung „Wiener Tag ↔ Zeitpunkt" bleibt in vienna-day.ts.

/** Wochentag eines Tages, 0 = Montag … 6 = Sonntag (ISO-8601, wie in Österreich gelesen). */
export function isoWeekdayIndex(day: string): number {
  const dow = new Date(`${day}T00:00:00.000Z`).getUTCDay(); // 0 = Sonntag
  return (dow + 6) % 7;
}

/** Alle Monate, die ein Zeitraum berührt: ("2026-08-11", "2026-09-02") -> ["2026-08", "2026-09"]. */
export function monthsBetween(fromDay: string, toDay: string): string[] {
  const out: string[] = [];
  let year = Number(fromDay.slice(0, 4));
  let month = Number(fromDay.slice(5, 7)); // 1–12
  const last = toDay.slice(0, 7);
  // Deckel gegen absurde Eingaben: Die Event-Recherche reicht drei Wochen voraus, mehr als
  // ein paar Monate kann hier nie stehen. Eine Endlosschleife im Render wäre ein weißer
  // Bildschirm, kein Fehler im Log.
  for (let i = 0; i < 120; i++) {
    const key = `${year}-${String(month).padStart(2, "0")}`;
    out.push(key);
    if (key >= last) break;
    if (month === 12) {
      year += 1;
      month = 1;
    } else {
      month += 1;
    }
  }
  return out;
}

/**
 * Die Felder eines Monatsgitters, Montag zuerst: `null` für die Leerfelder vor dem Ersten,
 * danach jeder Tag des Monats als „YYYY-MM-DD".
 *
 * Nachlaufende Leerfelder gibt es bewusst NICHT: Ein `grid-cols-7` bricht von selbst um,
 * und leere Zellen am Ende würden nur Platz kosten.
 */
export function monthGrid(month: string): (string | null)[] {
  const year = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7)); // 1–12
  const lead = isoWeekdayIndex(`${month}-01`);
  // Tag 0 des Folgemonats = letzter Tag dieses Monats. Deckt Schaltjahre mit ab.
  const days = new Date(Date.UTC(year, m, 0)).getUTCDate();
  const cells: (string | null)[] = Array.from({ length: lead }, () => null);
  for (let d = 1; d <= days; d++) {
    cells.push(`${month}-${String(d).padStart(2, "0")}`);
  }
  return cells;
}
