import type { Map as MapboxMap } from "mapbox-gl";

// ——— Karte aufräumen: unsere Spots sind die einzigen Punkte ————————————————
//
// Der Mapbox-Style „outdoors-v12" beschriftet ab Werk jeden Hofer, jedes Freibad, jede
// Polizeistation, jede Sehenswürdigkeit, jeden Gipfel und jeden See. Zwei Probleme:
//
//   1. ABLENKUNG. Auf unseren Karten ist der Marker die Botschaft. Jedes fremde Symbol
//      daneben ist ein zweiter Punkt, der um denselben Blick kämpft — und davon gibt es
//      hunderte pro Ausschnitt. Apple Maps macht auf seinen Übersichten dasselbe: erst
//      Fläche, Straße, Ortsname, und Punkte erst dann, wenn man sie sucht.
//   2. VERRAT. Wir verkaufen Spots, die man nicht kennt. Steht der Name des Sees, des
//      Wasserfalls oder des Wirtshauses direkt daneben auf der Karte, ist der gesperrte
//      Pro-Spot mit einem Blick gelöst — der verpixelte Teaser nützt dann nichts mehr.
//
// WAS BLEIBT: alles, was FLÄCHE und WEG ist (Wald, Wiese, Wasserflächen, Gletscher,
// Höhenlinien, Schummerung, Straßen, Wege, Bahn, Lifte, Gebäude) plus genau zwei Sorten
// Beschriftung:
//   • Straßennamen, Straßennummern und Autobahn-Ausfahrten  -> „welche Straße ist das"
//   • Orts-, Landes- und Ländernamen                        -> „wo bin ich überhaupt"
// Damit bleibt die Karte lesbar und man findet sich zurecht, ohne dass ein einziger
// fremder Punkt neben unseren Markern steht.
//
// WARUM ERLAUBEN STATT VERBIETEN: Die Liste unten sagt, was BLEIBEN darf; versteckt wird
// jede andere Beschriftung. Eine Verbotsliste wäre die bequemere Variante, hätte aber die
// falsche Fehlerrichtung: Fügt Mapbox mit dem nächsten Style-Update eine neue POI-Ebene
// hinzu, stünden unsere Geheimtipps plötzlich wieder namentlich auf der Karte. So herum
// ist ein Style-Update im schlimmsten Fall eine fehlende Straßenbeschriftung — sichtbar,
// harmlos, und in der Entwicklung meldet es die Warnung ganz unten.

/**
 * Beschriftungs-Ebenen, die sichtbar bleiben (IDs aus mapbox/outdoors-v12).
 * Alle anderen Symbol-Ebenen des Basis-Styles werden versteckt.
 */
const KEEP_LABELS = new Set([
  // Straße: Name, Nummernschild (z. B. „311"), Autobahn-Ausfahrt.
  "road-label",
  "road-number-shield",
  "road-exit-shield",
  // Orientierung im Großen: Dorf/Stadt, Bundesland, Land, Kontinent.
  // Bewusst NICHT dabei: „settlement-subdivision-label" (Ortsteile und Weiler wie
  // „Kollingwald" oder „Bsuch") — davon liegen im Pinzgau ein Dutzend pro Ausschnitt,
  // und keiner davon beantwortet „wo bin ich".
  "settlement-minor-label",
  "settlement-major-label",
  "state-label",
  "country-label",
  "continent-label",
]);

/**
 * Ebenen, die keine Symbol-Ebenen sind und trotzdem weg müssen.
 * „turning-feature" zeichnet ab Zoom 16 kleine Kreise für Abbiegeverbote — auf einer
 * Karte, deren einzige runde Punkte unsere Marker sein sollen, ist das der schlechteste
 * denkbare Zufall.
 */
const HIDE_ALWAYS = new Set(["turning-feature", "turning-feature-outline"]);

/** Präfix unserer eigenen Ebenen (Route, Marker-Helfer) — die fasst das hier nie an. */
const OWN_LAYER_PREFIX = "sg-";

// ——— Weiches Relief statt kantiger Schatten-Flächen ————————————————————————
//
// Outdoors zeichnet die Berge als vereinfachte Schatten-Flächen aus Vektor-Kacheln
// (Ebene „hillshade"). Weit herausgezoomt sieht man ihre Dreiecke, und an den
// Kachelgrenzen laufen harte Linien quer über das Land (Anton, 16.11.2026, in der App
// gesehen; das Web hat denselben Stil). Ersetzt durch ein Relief aus echten Höhendaten
// (Mapbox Terrain DEM): stetig, ohne Kanten, wie Apple Karten. Dezent eingestellt
// (Übertreibung 0,4 bis 0,25, warmer Schatten), damit Marker und Straßen vorne bleiben.
// Dieselben Werte wie in der iOS-App (MapStyleCleanup.applyRelief): EINE Karte, zwei
// Oberflächen.
const VECTOR_HILLSHADE = "hillshade";
const DEM_SOURCE = "sg-dem";
const RELIEF_LAYER = "sg-relief";
const RELIEF_SHADOW = "rgb(69, 64, 46)";

function applyRelief(map: MapboxMap) {
  const layers = map.getStyle()?.layers;
  if (!layers) return;
  const index = layers.findIndex((layer) => layer.id === VECTOR_HILLSHADE);
  // Kein „hillshade" im Stil (anderer Stil, Umbenennung): nichts anfassen.
  if (index < 0) return;
  try {
    if (!map.getSource(DEM_SOURCE)) {
      map.addSource(DEM_SOURCE, {
        type: "raster-dem",
        url: "mapbox://mapbox.mapbox-terrain-dem-v1",
        tileSize: 512,
        maxzoom: 14,
      });
    }
    if (!map.getLayer(RELIEF_LAYER)) {
      // Direkt über der alten Ebene einhängen: unter Wald-Kanten, Straßen und Beschriftung.
      const before = layers[index + 1]?.id;
      map.addLayer(
        {
          id: RELIEF_LAYER,
          type: "hillshade",
          source: DEM_SOURCE,
          paint: {
            "hillshade-exaggeration": ["interpolate", ["linear"], ["zoom"], 5, 0.4, 10, 0.32, 14, 0.25],
            "hillshade-shadow-color": RELIEF_SHADOW,
            "hillshade-accent-color": RELIEF_SHADOW,
            "hillshade-highlight-color": "rgba(255, 255, 255, 0.6)",
          },
        },
        before,
      );
    }
    map.setLayoutProperty(VECTOR_HILLSHADE, "visibility", "none");
  } catch {
    /* Style mitten im Wechsel -> beim nächsten style.load wieder */
  }
}

function hideClutter(map: MapboxMap) {
  const layers = map.getStyle()?.layers;
  if (!layers) return;

  for (const layer of layers) {
    if (layer.id.startsWith(OWN_LAYER_PREFIX)) continue;
    const clutter = HIDE_ALWAYS.has(layer.id) || (layer.type === "symbol" && !KEEP_LABELS.has(layer.id));
    if (!clutter) continue;
    try {
      map.setLayoutProperty(layer.id, "visibility", "none");
    } catch {
      /* Ebene inzwischen weg (Style-Wechsel) -> überspringen */
    }
  }

  // Sicherheitsnetz gegen den stillen Fall: Mapbox benennt eine Ebene um, die Erlaubnis-
  // Liste greift ins Leere, und die Karte steht ohne jede Beschriftung da. Das fällt beim
  // Draufschauen kaum auf („sieht halt aufgeräumt aus") — hier fällt es auf.
  if (process.env.NODE_ENV === "development") {
    const missing = [...KEEP_LABELS].filter((id) => !map.getLayer(id));
    if (missing.length) {
      console.warn(`[map-declutter] Diese Beschriftungs-Ebenen gibt es nicht mehr: ${missing.join(", ")}`);
    }
  }
}

/**
 * Räumt den Mapbox-Basis-Style auf: fremde Punkte und Namen raus, Straßen- und Ortsnamen
 * bleiben, das Relief kommt weich aus Höhendaten. Gilt für JEDE Karte der Plattform — direkt nach `new mapboxgl.Map(...)`
 * aufrufen, egal ob der Style schon geladen ist:
 *
 *   const map = new mapboxgl.Map({ ... });
 *   declutterBasemap(map);
 *
 * Der Aufruf wartet selbst auf den Style. Ebenen, die wir selbst anlegen („sg-…"), bleiben
 * unangetastet, egal wann sie dazukommen.
 */
export function declutterBasemap(map: MapboxMap) {
  const tidy = () => {
    hideClutter(map);
    applyRelief(map);
  };
  if (map.isStyleLoaded()) tidy();
  // Auch dann anmelden, wenn oben schon aufgeräumt wurde: `style.load` feuert bei jedem
  // Style-Wechsel erneut, und ein frischer Style bringt die volle Möblierung wieder mit.
  map.on("style.load", tidy);
}
