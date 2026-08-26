// ═══════════════════════════════════════════════════════════════════════════════════════
//  Sommer oder Winter: EINE Quelle für Typ, Datumsregel und Gedächtnis.
// ═══════════════════════════════════════════════════════════════════════════════════════
//
// Vorher stand das alles in Explore.tsx: der Typ in SeasonToggle.tsx, die Datumsregel als
// vierzeilige Funktion daneben, das Lesen und Schreiben von localStorage in zwei
// getrennten Effekten. Drei Stellen für eine einzige Entscheidung, und keine davon war
// von aussen prüfbar.
//
// Kein "use client" und kein Import: Die Regel gilt auf dem Server (Server-HTML) genauso
// wie im Browser. Nur die beiden Speicher-Funktionen fassen localStorage an und prüfen
// das selbst ab.

export type Season = "summer" | "winter";

/**
 * WANN DIE APP VON SELBST AUF WINTER STELLT.
 *
 * Recherche (08/2026), damit die zwei Zahlen unten nicht als Bauchgefühl dastehen:
 *
 *   - Statistik Austria und die Tourismusverbände rechnen das WINTERHALBJAHR von
 *     NOVEMBER BIS APRIL (Tourismusjahr = Nov bis Okt). Das ist die Einteilung, die
 *     jeder Partner im Land benutzt.
 *   - Salzburg liegt bei rund 51 % Winter- zu 49 % Sommernächtigungen. Stärkster Monat
 *     ist der FEBRUAR (4,4 Mio.), dann August (3,9) und Juli (3,8).
 *   - Die Skigebiete im Land laufen von Ende November (Zauchensee 27.11.) bis MITTE
 *     APRIL (11.04.). Nur das Kitzsteinhorn startet am Gletscher schon im Oktober.
 *
 * Daraus die Regel: Winter beginnt mit dem offiziellen Halbjahr am 1. November (da
 * öffnen die ersten Gebiete, der Advent läuft, die Winterreise wird geplant) und endet
 * am 15. April, wenn die Lifte zusperren. Der Rest des Aprils gehört schon dem Sommer:
 * Wer am 25. April auf die Karte schaut, will keine Gondel sehen, die stillsteht.
 *
 * Ändert sich das, ändert sich es HIER, an einer einzigen Stelle.
 */
const WINTER_STARTS = { month: 11, day: 1 }; // 1. November (Monat 1-basiert)
const WINTER_ENDS = { month: 4, day: 15 }; // 15. April, letzter Wintertag

/**
 * Datum in Wiener Zeit, als { month, day } mit 1-basiertem Monat.
 *
 * ZEITZONE HART GESETZT, und das ist kein Detail: `new Date().getMonth()` läuft auf
 * Vercel in UTC und im Browser in Ortszeit. In der Nacht auf den 1. November hätte der
 * Server also noch Sommer gerechnet und der Browser schon Winter — verschiedene Spots,
 * verschiedene Marker, und React flickt so einen Unterschied nicht, es malt still das
 * Falsche. Dieselbe Idiomatik wie in lib/analytics.ts und lib/events-format.ts.
 */
function viennaDate(now: Date): { month: number; day: number } {
  // en-CA liefert "YYYY-MM-DD" — die einzige Locale-Ausgabe, die man gefahrlos zerlegt.
  const [, m, d] = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Vienna" })
    .format(now)
    .split("-");
  return { month: Number(m), day: Number(d) };
}

/** Die Saison, die zum Datum passt. Ohne Argument: jetzt. */
export function naturalSeason(now: Date = new Date()): Season {
  const { month, day } = viennaDate(now);
  const afterStart =
    month > WINTER_STARTS.month ||
    (month === WINTER_STARTS.month && day >= WINTER_STARTS.day);
  const beforeEnd =
    month < WINTER_ENDS.month || (month === WINTER_ENDS.month && day <= WINTER_ENDS.day);
  // Der Winter läuft über den Jahreswechsel, deshalb ODER statt UND: November/Dezember
  // liegen nach dem Start, Januar bis Mitte April vor dem Ende.
  return afterStart || beforeEnd ? "winter" : "summer";
}

const KEY = "sg-season";

/**
 * Was der Nutzer zuletzt selbst gewählt hat — ABER NUR, SOLANGE ES NOCH GILT.
 *
 * Gespeichert wird nicht bloss die Saison, sondern auch der STEMPEL: welche Saison zum
 * Zeitpunkt der Wahl die natürliche war. Ist die natürliche Saison inzwischen eine
 * andere, war die Wahl eine Ausnahme für damals und wird verworfen.
 *
 * WARUM: Vorher lag hier nur "winter" oder "summer", für immer. Wer im Februar einmal
 * auf Sommer stellte, um eine Wanderung zu planen, bekam im August immer noch die
 * Ansicht vom Februar vorgesetzt und hatte keine Chance zu verstehen, warum die App
 * "falsch" startet. Ein Gedächtnis ohne Verfallsdatum ist bei etwas, das sich zweimal
 * im Jahr von selbst ändert, kein Komfort, sondern ein Fehler.
 *
 * Der alte, nackte Wert (nur der String) hat keinen Stempel und wird deshalb ignoriert:
 * Wir wissen nicht, aus welcher Saison heraus er gesetzt wurde, und raten wäre schlimmer
 * als der saubere Neustart mit der Datumsregel.
 */
export function readStoredSeason(): Season | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const { value, stamp } = parsed as { value?: unknown; stamp?: unknown };
    if (value !== "summer" && value !== "winter") return null;
    return stamp === naturalSeason() ? value : null;
  } catch {
    // Kein localStorage (Privat-Modus, Speicher blockiert) oder alter Wert im
    // Nur-String-Format: beides heisst hier dasselbe, nämlich "keine gültige Wahl".
    return null;
  }
}

/** Wahl merken, mit dem Stempel der aktuell natürlichen Saison. */
export function writeStoredSeason(value: Season): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ value, stamp: naturalSeason() }));
  } catch {
    // localStorage evtl. nicht verfügbar – dann gilt eben die Datumsregel.
  }
}
