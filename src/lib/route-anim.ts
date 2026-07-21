import type { Map as MapboxMap } from "mapbox-gl";

// ——— Route-Zeichnung: gemeinsamer Stil & Technik ————————————————————————
// Diese Konstanten und Helfer waren in SpotMap.tsx zu Hause. Sie liegen jetzt hier,
// damit die Live-Karte (SpotMap) UND der Intro-Video-Renderer (Render-Route
// /render/intro) exakt denselben Look zeichnen: eine rote Linie auf weißer Kontur, die
// sich per line-trim-offset vom Start zum Ziel zieht. Ein System, ein Look.

// IDs an einer Stelle, damit Aufbau und setTrim/setRouteOpacity nie auseinanderlaufen.
export const ROUTE_SOURCE = "sg-route";
export const ROUTE_LAYER_OUT = "sg-route-out";
export const ROUTE_LAYER_LINE = "sg-route-line";

export function routeFC(coords: [number, number][]) {
  return {
    type: "FeatureCollection" as const,
    features:
      coords.length >= 2
        ? [
            {
              type: "Feature" as const,
              geometry: { type: "LineString" as const, coordinates: coords },
              properties: {},
            },
          ]
        : [],
  };
}

// Technik: line-trim-offset. Die Eigenschaft macht einen Abschnitt der Linie
// unsichtbar; wir verstecken alles hinter dem Kopf und schieben den Kopf von 0 nach 1.
// Das sind pro Frame ZWEI ZAHLEN an die GPU, sonst nichts. Die naheliegende Variante
// (line-gradient mit line-progress) kostet pro Frame einen frischen Ausdruck, den
// Mapbox parst, prüft und als Farbtextur hochlädt. Bedingung für beides: lineMetrics
// an der Quelle.

// Zeichendauer in der Live-Karte: genau die Dauer des Kamerafluges (focus/fitBounds in
// SpotMap), damit Karte und Linie im selben Moment zur Ruhe kommen. Der Video-Renderer
// setzt seine eigene, längere Dauer über die Frame-Anzahl.
export const ROUTE_DRAW_MS = 600;
// Ausblenden ist bewusst kürzer, damit Route und Auswahl das Schließen anführen.
export const ROUTE_FADE_MS = 260;
// Weicher Kopf (Anteil der Streckenlänge): line-trim-fade-range lässt die Spitze
// auslaufen, statt sie wie abgeschnitten aussehen zu lassen.
export const ROUTE_HEAD = 0.05;

export const ROUTE_LINE = "#e04848";
export const ROUTE_OUT = "#ffffff";

// Mapbox legt auf line-opacity von sich aus einen 300ms-Übergang. Jeder Frame unserer
// Blende startete damit einen NEUEN Übergang, die Linie blieb fast deckend stehen. Wir
// steuern die Deckkraft selbst, deshalb muss Mapbox hier die Finger stillhalten.
export const NO_TRANSITION = { duration: 0, delay: 0 };

// Abbremsend (iOS-Gefühl): schnell los, sanft ankommen.
export const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

// Fortschritt 0..1. Der Zeitstempel von requestAnimationFrame liegt ein paar
// Millisekunden VOR performance.now(); ohne die untere Klemme wird der erste Schritt
// negativ und Mapbox weist die Deckkraft als über dem Maximum zurück.
export const progress = (now: number, t0: number, ms: number) =>
  Math.min(Math.max((now - t0) / ms, 0), 1);

// Linie bis `p` (0..1) zeigen. line-trim-offset [a,b] blendet den Abschnitt ZWISCHEN
// a und b aus, wir verstecken also alles hinter dem Kopf. p=0 -> [0,1] = ganz weg,
// p=1 -> [1,1] = nichts versteckt.
export function setTrim(map: MapboxMap, p: number) {
  const head = Math.min(Math.max(p, 0), 1);
  const trim: [number, number] = [head, 1];
  map.setPaintProperty(ROUTE_LAYER_OUT, "line-trim-offset", trim);
  map.setPaintProperty(ROUTE_LAYER_LINE, "line-trim-offset", trim);
}

export function setRouteOpacity(map: MapboxMap, o: number) {
  map.setPaintProperty(ROUTE_LAYER_OUT, "line-opacity", o);
  map.setPaintProperty(ROUTE_LAYER_LINE, "line-opacity", o);
}

// Quelle + beide Linien-Layer anlegen (weiße 6.5px-Kontur unter roter 3.5px-Linie).
// Idempotent: existiert die Quelle schon, passiert nichts. Genau dieser Aufbau lief
// vorher inline in SpotMap; jetzt teilen ihn Live-Karte und Renderer.
export function addRouteSourceAndLayers(map: MapboxMap, coords: [number, number][]) {
  if (map.getSource(ROUTE_SOURCE)) return;
  map.addSource(ROUTE_SOURCE, {
    type: "geojson",
    data: routeFC(coords),
    // Pflicht für line-progress -> ohne das kann sich die Linie nicht zeichnen.
    lineMetrics: true,
  });
  map.addLayer({
    id: ROUTE_LAYER_OUT,
    type: "line",
    source: ROUTE_SOURCE,
    paint: {
      "line-color": ROUTE_OUT,
      "line-width": 6.5,
      "line-opacity-transition": NO_TRANSITION,
      "line-trim-fade-range": [ROUTE_HEAD, 0],
    },
    layout: { "line-join": "round", "line-cap": "round" },
  });
  map.addLayer({
    id: ROUTE_LAYER_LINE,
    type: "line",
    source: ROUTE_SOURCE,
    paint: {
      "line-color": ROUTE_LINE,
      "line-width": 3.5,
      "line-opacity-transition": NO_TRANSITION,
      "line-trim-fade-range": [ROUTE_HEAD, 0],
    },
    layout: { "line-join": "round", "line-cap": "round" },
  });
}
