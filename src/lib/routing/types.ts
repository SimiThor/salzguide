// Routing: EINE Schnittstelle für alle Routen, die SalzGuide berechnet und speichert
// (docs/42). Reine Typen und reine Funktionen, KEIN `server-only`: Die Web-Navigation im
// Browser und das Swift-Paket der App brauchen dieselbe Umrechnung in NavStep, und ein
// server-only-Import in einer Client-Datei kippt jede Seite (tsc bleibt grün).
//
// Gespeichert wird nur, was uns gehört: unsere Linie, unsere Schritte, Profil, Quelle,
// Datum. Nie das Rohformat eines Anbieters (kein GeoJSON von BRouter, keine Mapbox-Schritte,
// keine Anbieter-Kennungen). Ein Anbieterwechsel kostet damit eine Datei, keine Migration.
import type { NavStep } from "../bike-nav-core";
import { prepareSteps, turnAngle, type RawStep } from "../nav-steps";
import type { TourMode } from "../tour-mode";

export type LngLat = [number, number];

/** Pflichtangabe überall, wo eine Linie oder ein Schritt aus OSM-Daten angezeigt wird (ODbL). */
export const OSM_ATTRIBUTION = "© OpenStreetMap-Mitwirkende";

// Wortschatz der Manöver: bewusst derselbe wie bisher (Mapbox-Begriffe), weil
// nav-steps.ts (isMereCurve), nav-format.ts (maneuverArrowDeg) und ManeuverBanner genau
// diese Wörter lesen. Neu ist nur, dass WIR sie vergeben.
export type ManeuverType = "turn" | "continue" | "fork" | "roundabout" | "off ramp" | "arrive";
export type ManeuverModifier =
  | "uturn"
  | "sharp right"
  | "right"
  | "slight right"
  | "straight"
  | "slight left"
  | "left"
  | "sharp left";

/** Ein Schritt in UNSEREM Format, sprachneutral (der Text entsteht erst beim Anzeigen). */
export type RouteStep = {
  /** Index des Manöverpunkts in `geometry`. */
  index: number;
  /** Strecke ab Routenstart bis zum Manöver, gemessen wie routeCumulativeMeters (geo.ts). */
  alongM: number;
  type: ManeuverType;
  modifier?: ManeuverModifier;
  /** Kurs vor und nach dem Manöver, 0 bis 359 Grad ab Norden. turnAngle() daraus = Abbiegewinkel. */
  bearingBefore: number;
  bearingAfter: number;
  /** Strecke bis zum nächsten Schritt (beim letzten: bis zum Ende). */
  distanceM: number;
  /** Nur im Kreisverkehr: die wievielte Ausfahrt. */
  exit?: number;
};

export type RouteSource = {
  /** "brouter" oder "local" (Testadapter). */
  provider: "brouter" | "local";
  /** Profil beim Dienst, etwa "trekking". */
  profile: string;
  /** Programmstand des Dienstes, etwa "BRouter-1.7.10"; null, wenn er keinen nennt. */
  engine: string | null;
  /** Herkunft der Wegdaten, für Anzeige und Lizenz. */
  data: "OpenStreetMap (ODbL)" | "Testadapter";
  attribution: string;
  /** ISO-Zeitpunkt der Berechnung. */
  computedAt: string;
};

/** Eine berechnete Route, normalisiert. Das ist die Form, die gespeichert und ausgeliefert wird. */
export type NormalizedRoute = {
  /** Formatversion; Änderungen nur additiv, Bruch heisst v: 2. */
  v: 1;
  geometry: LngLat[];
  /** Je Punkt der Geometrie die Strecke ab Start (nicht gespeichert, aus geometry ableitbar). */
  alongM: number[];
  /**
   * Höhe je Punkt der Geometrie in Metern, aus den Wegdaten des Dienstes (BRouter: SRTM in
   * den rd5-Dateien). null, wenn er keine nennt. Braucht das Höhenprofil der Spot-Wanderungen
   * (routing/snap-spot.ts); in tour_nav_routes wird es nicht abgelegt.
   */
  elevationM: number[] | null;
  distanceM: number;
  /** Dauer laut Dienst; die Anzeige rechnet ihre eigene (docs/42, Abschnitt 4). */
  durationS: number | null;
  ascentM: number | null;
  steps: RouteStep[];
  /** Je Eingabepunkt (gleiche Reihenfolge wie die Anfrage) seine Stelle auf der Linie. */
  waypointAlongM: number[];
  /** Fingerabdruck der Geometrie: Schritte und Stellen gelten nur für genau diese Linie. */
  lineHash: string;
  source: RouteSource;
  /** Hinweise für Admin und Prüfskripte, nie für Gäste. */
  warnings: string[];
};

export type RouteRequest = {
  /** Kette in Fahrtrichtung: Start, Stopps, Wegpunkte, Ziel (buildBikeChain / flattenChain). */
  points: LngLat[];
  mode: TourMode;
  /** Optional ein Name je Punkt ("Stopp 3", "Start") für die Hinweise an den Admin. */
  labels?: string[];
  /**
   * Profil beim Dienst statt des Profils nach `mode`. Nur für den Rückfall der Spot-Spur
   * (routing/snap-spot.ts: ein Stück, das das Wanderprofil nicht in der Frist schafft, mit
   * `trekking`). Runden, Paket und Navigation setzen es nie.
   */
  profile?: string;
  signal?: AbortSignal;
};

export interface RoutingProvider {
  readonly name: RouteSource["provider"];
  route(request: RouteRequest): Promise<NormalizedRoute>;
}

export type RoutingErrorCode =
  | "config" // kein Dienst eingerichtet
  | "auth" // Token abgelehnt
  | "timeout"
  | "unreachable"
  | "no-route" // zwischen diesen Punkten kein Weg (auch: Punkt ausserhalb der Wegdaten)
  | "invalid" // Eingabe verletzt die Grenzen unten
  | "bad-response"; // Antwort unlesbar oder zu gross

export class RoutingError extends Error {
  readonly code: RoutingErrorCode;
  // Ohne Parameter-Properties: Die Prüfskripte laufen mit --experimental-strip-types.
  constructor(code: RoutingErrorCode, message: string) {
    super(message);
    this.name = "RoutingError";
    this.code = code;
  }
}

// Grenzen, die für jeden Anbieter gelten. 25 Punkte = MAX_DIRECTIONS_COORDS (tour-route.ts):
// Editor, Navigation und Server rechnen damit schon. BRouter könnte mehr, aber eine zweite
// Zahl hiesse wieder zwei Stellen, die auseinanderlaufen.
export const MIN_ROUTE_POINTS = 2;
export const MAX_ROUTE_POINTS = 25;
/** Längster gerader Abstand zwischen zwei aufeinanderfolgenden Punkten. Mehr ist keine Runde. */
export const MAX_HOP_M = 30_000;

// ── Umrechnung in das Format, das stepNav und ManeuverBanner lesen ─────────────────────

/**
 * Text einer Anweisung. Kommt aus den Sprachdateien (Tours.maneuver.*), nicht vom
 * Routendienst: BRouter liefert keine Texte und keine Strassennamen, und so sagt die
 * Navigation in allen 13 Sprachen dasselbe.
 */
export type InstructionFor = (step: Pick<RouteStep, "type" | "modifier" | "exit">) => string;

/**
 * Unsere Schritte -> NavStep[] für stepNav. Läuft durch DASSELBE prepareSteps wie bisher
 * die Mapbox-Schritte (Bögen raus, Paare unter 50 m bündeln). Der Winkel kommt aus
 * bearingBefore/bearingAfter, genau wie früher aus bearing_before/bearing_after.
 */
export function toNavSteps(steps: RouteStep[], instructionFor: InstructionFor): NavStep[] {
  const raw: RawStep[] = steps.map((s) => ({
    alongM: s.alongM,
    instruction: instructionFor(s),
    type: s.type,
    modifier: s.modifier,
    angleDeg: s.type === "arrive" ? null : turnAngle(s.bearingBefore, s.bearingAfter),
  }));
  return prepareSteps(raw);
}
