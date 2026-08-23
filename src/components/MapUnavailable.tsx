"use client";

import mapboxgl from "mapbox-gl";
import { reportClientError } from "@/lib/ops-client";
import { isWebglInitError } from "@/lib/ops-events";

// Der Hinweis selbst wohnt seit 23.08.2026 in einer eigenen Datei, OHNE mapbox-gl im
// Gepäck: MapLoading.tsx zeigt ihn auch dann, wenn die Mapbox-Datei gar nicht ankommt,
// und darf dafür nicht ausgerechnet an ihr hängen. Hier nur weitergereicht, damit die
// Karten ihn weiterhin zusammen mit tryCreateMap von einer Stelle holen.
export { MapUnavailableScreen } from "./MapUnavailableScreen";

/**
 * Karte ohne WebGL: EIN Fangnetz und EIN Hinweis für alle Karten der Seite.
 *
 * Das Problem: `new mapboxgl.Map()` wirft „Failed to initialize WebGL.", wenn der
 * Browser keinen WebGL-Kontext hergibt (Hardware-Beschleunigung abgeschaltet, uralte
 * Treiber, Bots ohne Grafik). Der Wurf passiert im Karten-Effekt, läuft also in die
 * React-Fehlergrenze — und der Besucher sah statt einer Spot-Seite mit einem grauen
 * Kartenkasten die KOMPLETTE Fehlerseite (so geschehen am 10./11.08.2026, Logbuch
 * „Failed to initialize WebGL" auf /en/spot/*).
 *
 * Die Lösung in zwei Teilen, beide hier, damit keine Karte sie anders baut:
 *
 *   tryCreateMap()          statt `new mapboxgl.Map()`. Gibt bei fehlendem WebGL `null`
 *                           zurück und meldet den Fall EINMAL leise (der Server sortiert
 *                           ihn per isWebglInitError als Notiz ein, nicht als Fehler).
 *                           Jeder ANDERE Wurf (fehlender Container, kaputte Optionen)
 *                           bleibt laut — das wären echte Fehler von uns.
 *
 *   MapUnavailableScreen    der Hinweis an der Stelle der Karte. Gehört wie der
 *                           Ladeschirm als letztes Kind in den `relative isolate`-
 *                           Kasten der Karte, ANSTELLE des MapLoadingScreen (der würde
 *                           ohne Karte für immer schimmern).
 *
 * Benutzung (identisch in jeder Karte):
 *
 *   const [mapDead, setMapDead] = useState(false);
 *   // im Effekt:
 *   const map = tryCreateMap({ container, ... });
 *   if (!map) { setMapDead(true); return; }
 *   // im Markup:
 *   {mapDead ? <MapUnavailableScreen /> : <MapLoadingScreen {...loading} />}
 */
export function tryCreateMap(options: mapboxgl.MapOptions): mapboxgl.Map | null {
  // ERST FRAGEN, DANN BAUEN.
  //
  // `mapboxgl.supported()` ist Mapbox' eigene Prüfung (ist das ein Browser, kann er Canvas
  // und getImageData, gibt er WebGL 2 her) und beantwortet genau die Frage, an der der
  // Konstruktor sonst zerbricht. Sie zu stellen ist keine Kosmetik: Der werfende
  // Konstruktor hinterlässt einen halb bemalten Container, den der Fang unten wieder
  // leerräumen muss. Der gefragte Weg fasst den Container nie an.
  //
  // Mapbox 3 verlangt WebGL 2. Auf einem Gerät, das nur WebGL 1 kann, sagt diese Prüfung
  // nein, und das ist die richtige Antwort: Die Karte käme dort auch nach dem Bauen nicht.
  //
  // Das `typeof` davor ist kein Zierrat. `supported()` kommt aus einem Paket, das gar nicht
  // installiert ist (mapbox-gl liefert es mitgebündelt), seine Typen laufen deshalb ins
  // Leere — tsc würde es NICHT merken, wenn Mapbox die Funktion eines Tages entfernt. Ohne
  // die Prüfung stünde dann ein „supported is not a function" an der einen Stelle, die
  // ausdrücklich dafür da ist, dass eine Karte nie die ganze Seite mitreisst.
  if (typeof mapboxgl.supported === "function" && !mapboxgl.supported()) {
    reportClientError(new Error("WebGL not supported by this browser (mapbox pre-check)."));
    return null;
  }
  try {
    return new mapboxgl.Map(options);
  } catch (err) {
    // Zweiter Riegel, und er bleibt nötig: Die Prüfung oben sagt nur, ob der Browser WebGL
    // GRUNDSÄTZLICH kann. Scheitern kann das Bauen trotzdem, etwa wenn auf einer Seite zu
    // viele Kontexte gleichzeitig leben oder der Grafiktreiber mittendrin aussteigt.
    if (err instanceof Error && isWebglInitError(err.message)) {
      // Der gescheiterte Konstruktor räumt nicht hinter sich auf: Er hat dem Container
      // schon Kind-Elemente und die mapboxgl-map-Klasse verpasst, bevor er wirft (im
      // Dev-StrictMode sichtbar als „container should be empty"-Warnung beim zweiten
      // Anlauf). Zurücklassen wollen wir einen sauberen, leeren Kasten.
      if (options.container instanceof HTMLElement) {
        options.container.replaceChildren();
        options.container.classList.remove("mapboxgl-map");
      }
      reportClientError(err);
      return null;
    }
    throw err;
  }
}
