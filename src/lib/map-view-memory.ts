"use client";

import type mapboxgl from "mapbox-gl";

/**
 * Kamera-Gedächtnis für die Vollbild-Karten (Explore, Wasser).
 *
 * DAS PROBLEM: Wer auf der Karte zu einem Spot hinzoomt, seine Seite öffnet und
 * zurückkommt, landet wieder auf der ganz herausgezoomten Übersicht. Die Seite wird
 * beim Zurücknavigieren komplett neu aufgebaut, die Karte kennt ihren letzten
 * Ausschnitt nicht mehr und passt sich sofort auf alle Marker ein.
 *
 * DIE LÖSUNG: Nach jeder Bewegung (moveend) merkt sich die Karte ihren Ausschnitt in
 * sessionStorage. Beim nächsten Aufbau startet sie direkt dort, und der Aufrufer
 * überspringt sein erstes automatisches Einpassen. sessionStorage mit Absicht:
 *   - pro Tab, überlebt die Client-Navigation (genau der "zurück"-Fall),
 *   - ein neuer Tab / neuer Besuch startet frisch auf der Übersicht,
 *   - nichts davon landet auf dem Server oder in Cookies.
 * Dazu eine Ablaufzeit: Wer nach einer halben Stunde zurückkommt, ist gedanklich
 * nicht mehr "mitten in der Suche" und bekommt wieder die Übersicht.
 */
export type SavedMapView = {
  center: [number, number]; // [lng, lat]
  zoom: number;
  bearing: number;
};

const PREFIX = "sg-map-view:";
const MAX_AGE_MS = 30 * 60 * 1000; // 30 Minuten

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Gemerkten Ausschnitt lesen. Bei allem Unerwarteten (kaputtes JSON, Werte außerhalb
 *  jeder Plausibilität, abgelaufen, Storage gesperrt) einfach null: Die Karte fällt
 *  dann auf ihr normales Einpassen zurück, nie auf einen kaputten Zustand. */
export function readMapView(key: string): SavedMapView | null {
  try {
    const raw = sessionStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const v: unknown = JSON.parse(raw);
    if (typeof v !== "object" || v === null) return null;
    const { lng, lat, zoom, bearing, at } = v as Record<string, unknown>;
    if (!finite(lng) || !finite(lat) || !finite(zoom) || !finite(bearing) || !finite(at))
      return null;
    if (lng < -180 || lng > 180 || lat < -90 || lat > 90) return null;
    if (zoom < 0 || zoom > 22) return null;
    if (Date.now() - at > MAX_AGE_MS) return null;
    return { center: [lng, lat], zoom, bearing };
  } catch {
    return null; // sessionStorage nicht verfügbar oder Inhalt unbrauchbar
  }
}

/**
 * Karte ans Gedächtnis hängen: speichert nach jeder abgeschlossenen Bewegung
 * (moveend feuert auch nach fitBounds/flyTo, also ist immer der letzte echte
 * Ausschnitt drin). Gibt die Trennfunktion zurück; die speichert beim Abbauen noch
 * einmal, damit auch der allerletzte Stand sicher drin ist.
 */
export function bindMapViewMemory(map: mapboxgl.Map, key: string): () => void {
  const save = () => {
    try {
      // wrap(): Mapbox kann die Länge beim Ziehen über die Datumsgrenze aus dem
      // ±180-Bereich laufen lassen; normalisiert bleibt der Wert immer lesbar.
      const c = map.getCenter().wrap();
      sessionStorage.setItem(
        PREFIX + key,
        JSON.stringify({
          lng: c.lng,
          lat: c.lat,
          zoom: map.getZoom(),
          bearing: map.getBearing(),
          at: Date.now(),
        }),
      );
    } catch {
      // Storage voll oder gesperrt: dann eben kein Gedächtnis, die Karte läuft normal.
    }
  };
  map.on("moveend", save);
  return () => {
    save();
    map.off("moveend", save);
  };
}
