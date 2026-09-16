"use client";

/**
 * Gedächtnis einer Runde (Rad und zu Fuss): welche Halte erledigt und welche Geschichten
 * gehört sind.
 *
 * DAS PROBLEM: Tab zu, Handy aus, Rückkehr von der Stripe-Kasse. Die Seite baut sich neu
 * auf, und bis 15.09.2026 begann die Runde dann wieder bei Halt 1: GPS-Gate, Route über
 * alle Halte, Angebot für die erste Geschichte, mitten in der Stadt bei Halt 4.
 *
 * DIE LÖSUNG: localStorage, je Runde ein Eintrag. Bewusst nicht sessionStorage (stirbt mit
 * dem Tab, und genau der Tab ist weg) und kein Cookie (ginge mit jeder Anfrage an den
 * Server, dort hat es nichts verloren). Gespeichert wird nur, was der Kern nicht aus der
 * Position ableiten kann: die erledigten Halte (Tour-Indizes) und das Gehörte. Route und
 * Fortschritt werden beim Wiedereinstieg ab der echten Position neu geholt, derselbe Weg
 * wie eine Neuberechnung (useBikeNavigation, resumeDone).
 *
 * Ablauf nach 12 Stunden: Ein S-Bike hat ein Mietlimit von vier Stunden (docs/40). Wer am
 * nächsten Tag wiederkommt, fängt eine neue Runde an, ohne gefragt zu werden.
 */
export type SavedRide = {
  done: number[];
  heard: number[];
};

// Neutraler Name seit 16.09.2026 (Geh-Runden haben dasselbe Gedaechtnis). Der alte
// Schluessel "sg-bike-nav:" faellt still weg: Eintraege leben ohnehin nur 12 Stunden.
const PREFIX = "sg-tour-nav:";
const MAX_AGE_MS = 12 * 60 * 60 * 1000;
// Plausibilität: So viele Halte hat keine Runde (Mapbox nimmt 25 Punkte je Anfrage).
const MAX_STOPS = 50;

const key = (slug: string) => PREFIX + slug;

function indexList(v: unknown): number[] | null {
  if (!Array.isArray(v) || v.length > MAX_STOPS) return null;
  const out = new Set<number>();
  for (const x of v) {
    if (typeof x !== "number" || !Number.isInteger(x) || x < 0 || x >= MAX_STOPS) return null;
    out.add(x);
  }
  return Array.from(out);
}

/** Gemerkten Stand lesen. Bei allem Unerwarteten (kaputtes JSON, unplausible Werte,
 *  abgelaufen, Storage gesperrt) einfach null: Dann beginnt die Runde ganz normal. */
export function readRide(slug: string): SavedRide | null {
  try {
    const raw = localStorage.getItem(key(slug));
    if (!raw) return null;
    const v: unknown = JSON.parse(raw);
    if (typeof v !== "object" || v === null) return null;
    const { done, heard, at } = v as Record<string, unknown>;
    if (typeof at !== "number" || !Number.isFinite(at)) return null;
    if (Date.now() - at > MAX_AGE_MS) return null;
    const d = indexList(done);
    const h = indexList(heard);
    if (!d || !h) return null;
    return { done: d, heard: h };
  } catch {
    return null;
  }
}

export function writeRide(slug: string, ride: SavedRide): void {
  try {
    localStorage.setItem(
      key(slug),
      JSON.stringify({ done: ride.done, heard: ride.heard, at: Date.now() }),
    );
  } catch {
    // Storage voll oder gesperrt: dann eben kein Gedächtnis, die Runde läuft normal.
  }
}

export function clearRide(slug: string): void {
  try {
    localStorage.removeItem(key(slug));
  } catch {
    /* nichts zu löschen */
  }
}
