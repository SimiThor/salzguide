import type { NavStep } from "./bike-nav-core";

// ═══════════════════════════════════════════════════════════════════════════════════════
//  Aus Mapbox-Schritten werden Ansagen, die man am Rad auch brauchen kann.
// ═══════════════════════════════════════════════════════════════════════════════════════
//
// GEMESSEN AN DER ECHTEN RUNDE A (25.08.2026): 54 Schritte auf 9,6 km, im Schnitt alle
// 178 Meter einer. Wer das ungefiltert ansagt, redet die ganze Fahrt.
//
// Zwei Regeln aus docs/40, beide waren dort als Zusage notiert und ohne Code:
//
//   1. EIN BOGEN IST KEINE ABBIEGUNG. Unter 35 Grad folgt man einfach der Strasse. Mapbox
//      liefert die Winkel als `bearing_before`/`bearing_after` mit, sie wurden nur nie
//      gelesen.
//   2. ZWEI ABBIEGUNGEN UNTER 50 METERN GEHOEREN ZUSAMMEN. Sonst hoert der Gast "rechts"
//      und steht zwanzig Meter spaeter vor der naechsten Kreuzung.
//
// WAS HIER BEWUSST NICHT PASSIERT: Es wird nichts weggeworfen, das man braucht. Die zweite
// Abbiegung eines Paares bleibt als eigener Schritt stehen, sie wird nur zusaetzlich schon
// beim ersten angekuendigt. Und verworfen wird ausschliesslich, was BEIDES ist, flach UND
// von harmloser Art. Ein "end of road" mit 20 Grad bleibt, denn dort endet die Strasse,
// egal wie flach der Knick ist.

/** So flach ist es ein Bogen und keine Abbiegung. */
export const CURVE_MAX_DEG = 35;
/** So nah beieinander gehoeren zwei Abbiegungen in EINE Ansage. */
export const BUNDLE_MAX_M = 50;

// Arten, bei denen ein flacher Winkel wirklich nur ein Bogen ist. Alles andere bleibt,
// auch flach: Bei "end of road", "merge", "fork" oder einem Kreisverkehr entscheidet nicht
// der Winkel, ob man aufpassen muss.
const HARMLOS = new Set(["turn", "new name", "continue"]);
// Richtungen, die man nie verschluckt, egal wie klein der Winkel gerechnet ist.
const IMMER_ANSAGEN = new Set(["left", "right", "sharp left", "sharp right", "uturn"]);

/**
 * Um wie viel Grad man abbiegt, 0 bis 180. 0 = geradeaus, 180 = Kehre.
 *
 * Die Formel bringt die Differenz zuerst in den Bereich von minus 180 bis 180, damit der
 * Sprung bei 360 Grad nicht durchschlägt: Ein Kurswechsel von 350 auf 10 Grad sind zwanzig
 * Grad, nicht dreihundertvierzig.
 */
export function turnAngle(before: number | undefined, after: number | undefined): number | null {
  if (before == null || after == null) return null;
  return Math.abs(((after - before + 540) % 360) - 180);
}

export type RawStep = NavStep & { angleDeg?: number | null };

/**
 * Bogen oder Abbiegung? `null` beim Winkel heisst: Mapbox hat keinen geliefert, dann wird
 * nicht verworfen. Im Zweifel ansagen.
 */
export function isMereCurve(step: RawStep): boolean {
  if (step.type === "arrive" || step.type === "depart") return false;
  if (step.angleDeg == null) return false;
  if (IMMER_ANSAGEN.has(step.modifier ?? "")) return false;
  if (!HARMLOS.has(step.type)) return false;
  return step.angleDeg < CURVE_MAX_DEG;
}

/**
 * Die Schrittliste fuers Fahren aufbereiten: Boegen raus, dicht beieinanderliegende
 * Abbiegungen aneinanderhaengen.
 *
 * `followedBy` traegt die ZWEITE Abbiegung eines Paares. Die Oberflaeche zeigt sie als
 * "dann" hinter der ersten an; als eigener Schritt bleibt sie trotzdem in der Liste.
 */
export function prepareSteps(raw: RawStep[]): NavStep[] {
  const behalten = raw.filter((s) => !isMereCurve(s));
  return behalten.map((s, i) => {
    const naechste = behalten[i + 1];
    const dicht = naechste != null && naechste.alongM - s.alongM <= BUNDLE_MAX_M;
    const { angleDeg: _weg, ...rest } = s;
    void _weg;
    return dicht
      ? { ...rest, followedBy: { type: naechste.type, modifier: naechste.modifier } }
      : rest;
  });
}
