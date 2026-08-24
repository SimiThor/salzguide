"use client";

// ═══ TESTHAKEN – NICHT DAUERHAFT ═══
// Google-Gegenstück zu bike-directions.ts: dieselbe Aufgabe (Etappen-Routing für GENAU
// EINEN Tour-Stopp, mit Manöver-Schritten für die Abbiege-Anzeige), aber über die Google
// Maps JavaScript API statt Mapbox. Läuft komplett im Browser über den öffentlichen,
// URL-beschränkten Schlüssel (google-maps-loader.ts) – kein eigener Server-Call nötig,
// google.maps.DirectionsService macht den Request selbst.
//
// PROFIL: BICYCLING zuerst, WALKING als Rückfall. Google liefert bei BICYCLING gelegentlich
// ZERO_RESULTS (z.B. sehr kurze Etappen oder Wege, die nicht als radtauglich getaggt sind –
// dieselbe Klasse Problem wie in test-sbike-tour.ts für Mapbox beschrieben). Anders als dort
// wird hier NICHT zusätzlich das kürzere von zwei Profilen gesucht (ein Fetch weniger pro
// Etappe reicht für diesen Test) – Rückfall erst, wenn BICYCLING wirklich keine Route findet.
import { loadGoogleMapsLibraries } from "./google-maps-loader";
import type { NavLeg, NavStep } from "./bike-nav-core";

export type GoogleBikeLegError = "no-key" | "network" | "no-route";

export type GoogleBikeLegResult =
  | { ok: true; leg: NavLeg; distanceM: number; durationS: number }
  | { ok: false; error: GoogleBikeLegError };

// Googles `maneuver`-Vokabular (DirectionsStep.maneuver) auf dasselbe {type, modifier}-Paar
// abgebildet, das bike-nav-core.ts/ManeuverBanner.tsx/nav-format.ts schon von Mapbox kennen
// (siehe MODIFIER_DEG in nav-format.ts) – so bleibt die komplette Abbiege-Anzeige UNVERÄNDERT
// wiederverwendbar, nur diese eine Übersetzung ist neu. Ein leeres `maneuver` (Google lässt es
// bei einfachem Geradeausfahren oft weg) wird "straight".
const MANEUVER_MODIFIER: Record<string, string> = {
  "turn-slight-left": "slight left",
  "turn-sharp-left": "sharp left",
  "turn-left": "left",
  "turn-slight-right": "slight right",
  "turn-sharp-right": "sharp right",
  "turn-right": "right",
  "uturn-left": "uturn",
  "uturn-right": "uturn",
  "roundabout-left": "left",
  "roundabout-right": "right",
  "fork-left": "slight left",
  "fork-right": "slight right",
  "ramp-left": "left",
  "ramp-right": "right",
  merge: "straight",
  straight: "straight",
  "keep-left": "slight left",
  "keep-right": "slight right",
  ferry: "straight",
  "ferry-train": "straight",
};

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

async function fetchGoogleLeg(
  service: google.maps.DirectionsService,
  travelMode: google.maps.TravelMode,
  from: [number, number],
  to: [number, number],
  locale: string,
): Promise<{ leg: NavLeg; distanceM: number; durationS: number } | null> {
  let res: google.maps.DirectionsResult;
  try {
    res = await service.route({
      origin: { lat: from[1], lng: from[0] },
      destination: { lat: to[1], lng: to[0] },
      travelMode,
      // Nur der eine, direkte Weg – für "Navigation zum nächsten Stopp" gibt es keine
      // sinnvolle Alternative zum Auswählen (kein UI dafür, siehe Prioritäten des Tests).
      provideRouteAlternatives: false,
      // Ohne das antwortet Google in der Browser-/Geräte-Spracheinstellung statt in der
      // Sprache der Seite (bike-directions.ts macht dasselbe für Mapbox).
      language: locale,
    });
  } catch (err) {
    // Googles echte Fehlermeldung (z.B. "REQUEST_DENIED: ... RefererNotAllowedMapError")
    // steckt in `err`, ging bisher aber im stillen `null` unter – sichtbar nur noch in der
    // Browser-Konsole (F12), aber sichtbar. Kein reportClientError o.ä.: Diese Testseite
    // hat keine eigene Fehler-Meldestelle, und ein swallowed catch wäre genau das Problem,
    // das sich hier schon einmal als "Gerade nicht erreichbar" ohne Grund gezeigt hat.
    console.error("[google-bike-directions] DirectionsService.route() fehlgeschlagen:", err);
    return null;
  }
  const route = res.routes?.[0];
  const rLeg = route?.legs?.[0];
  if (!route || !rLeg) return null;

  const geometry: [number, number][] = route.overview_path.map((p) => [p.lng(), p.lat()]);
  // Steht der Nutzer schon (fast) auf dem Zielpunkt – z.B. direkt nach dem Start oder kurz
  // vor einer Ankunft –, liefert Google eine "Route" mit nur einem einzigen Wegpunkt statt
  // einer Linie. Das ist eine ECHTE, nur sehr kurze Etappe, kein Fehler: bike-nav-core.ts
  // (nearestPointOnRoute in geo.ts) braucht mindestens zwei Punkte, deshalb hier auf die
  // beiden Endpunkte auffüllen statt die Etappe zu verwerfen – sonst zeigt das HUD an genau
  // dieser Stelle fälschlich "Gerade nicht erreichbar".
  if (geometry.length < 2) {
    geometry.length = 0;
    geometry.push(from, to);
  }

  // Jedes Google-Step-Objekt trägt (anders als bei Mapbox) das Manöver, mit dem es ENDET
  // (der Abbiege-Punkt liegt am Ende des Steps, nicht am Anfang) – alongM ist deshalb die
  // Summe der Distanzen BIS EINSCHLIESSLICH dieses Steps.
  let cum = 0;
  const steps: NavStep[] = [];
  for (const s of rLeg.steps) {
    cum += s.distance?.value ?? 0;
    const modifier = MANEUVER_MODIFIER[s.maneuver ?? ""] ?? "straight";
    steps.push({
      alongM: cum,
      instruction: stripHtml(s.instructions ?? ""),
      type: "turn",
      modifier,
    });
  }
  // Synthetischer Ankunfts-Schritt am Etappenende, wie ihn Mapbox von sich aus mitliefert
  // (dessen letztes Step hat type:"arrive") – ManeuverBanner.tsx zeigt dafür die Zielflagge
  // statt eines Abbiege-Pfeils.
  steps.push({ alongM: cum, instruction: "Ziel erreicht", type: "arrive" });

  return {
    leg: { geometry, steps, stop: to },
    distanceM: typeof rLeg.distance?.value === "number" ? rLeg.distance.value : cum,
    durationS: typeof rLeg.duration?.value === "number" ? rLeg.duration.value : 0,
  };
}

export async function fetchGoogleBikeLeg(
  from: [number, number],
  to: [number, number],
  apiKey: string,
  locale: string,
): Promise<GoogleBikeLegResult> {
  if (!apiKey) return { ok: false, error: "no-key" };
  try {
    const { DirectionsService } = await loadGoogleMapsLibraries(apiKey);
    const service = new DirectionsService();
    const bike = await fetchGoogleLeg(
      service,
      google.maps.TravelMode.BICYCLING,
      from,
      to,
      locale,
    );
    if (bike) return { ok: true, ...bike };
    const walk = await fetchGoogleLeg(service, google.maps.TravelMode.WALKING, from, to, locale);
    if (walk) return { ok: true, ...walk };
    return { ok: false, error: "no-route" };
  } catch {
    return { ok: false, error: "network" };
  }
}
