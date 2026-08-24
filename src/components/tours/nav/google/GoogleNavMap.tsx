"use client";

import { useEffect, useRef, useState } from "react";
import { useLatestRef } from "@/lib/use-latest-ref";
import { MapUnavailableScreen } from "@/components/MapUnavailableScreen";
import { loadGoogleMapsLibraries } from "@/lib/google-maps-loader";
import type { NavStopPoint } from "../NavMap";

// ═══ TESTHAKEN – NICHT DAUERHAFT ═══
// Google-Gegenstück zu NavMap.tsx (Mapbox), fürs Vergleichstest (docs/40-Test): dieselbe
// Aufgabe (permanent der Position folgende Karte + Route + Ziel-Pins fürs S-Bike-HUD), aber
// mit `google.maps.Map` statt `mapboxgl.Map`.
//
// KAMERA-FÜHRUNG, ZWEI STUFEN:
//   - Mit `mapId` (NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID, eine "Vector Map" aus der Google Cloud
//     Console): echte 3D-Kamera mit Neigung + Fahrtrichtung, per `map.moveCamera()` – die
//     Mapbox-Anmutung (geneigt, dreht sich mit dem Kurs).
//   - Ohne `mapId`: Google rendert dann eine klassische Raster-Karte, die `tilt`/`heading`
//     NICHT unterstützt (das ist eine Google-Einschränkung, keine dieser Datei: Neigung/
//     Drehung sind Vector-Maps vorbehalten). Die Karte bleibt Nord-oben, dafür zeigt der
//     Positions-Pfeil selbst die Fahrtrichtung (Rotation am Symbol).
// Recherche-Ergebnis (siehe Zusammenfassung im PR/Chat): Google bietet für Web KEIN
// eigenständiges "Navigation SDK" mit eingebauter Turn-by-Turn-Führung (das gibt es nur für
// Android/iOS/Flutter) – die hier gebaute Kombination aus Maps JavaScript API + Directions
// Service + eigener Kern (bike-nav-core.ts) IST die technisch beste verfügbare Variante.
const NAV_ZOOM = 17;
const NAV_TILT = 45; // nur wirksam mit Vector-Map (mapId)

export default function GoogleNavMap({
  apiKey,
  mapId,
  route,
  fix,
  bearingDeg,
  stops,
  activeIndex,
  paddingBottom = 0,
  recenterLabel,
}: {
  apiKey: string;
  mapId?: string;
  route: [number, number][] | null;
  fix: { lng: number; lat: number } | null;
  bearingDeg: number;
  stops: NavStopPoint[];
  activeIndex: number;
  paddingBottom?: number;
  recenterLabel: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const polylineRef = useRef<google.maps.Polyline | null>(null);
  const puckRef = useRef<google.maps.Marker | null>(null);
  const stopMarkersRef = useRef<Map<number, google.maps.Marker>>(new Map());
  const [ready, setReady] = useState(false);
  const [mapDead, setMapDead] = useState(false);
  const [following, setFollowing] = useState(true);
  const paddingBottomRef = useLatestRef(paddingBottom);
  const vector = !!mapId;

  // Karte einmalig aufbauen (dasselbe Muster wie NavMap.tsx: EIN Effekt ohne Deps, Aufräumen
  // im Rückgabewert).
  useEffect(() => {
    if (!containerRef.current || mapRef.current || !apiKey) return;
    let cancelled = false;
    loadGoogleMapsLibraries(apiKey)
      .then(({ Map }) => {
        if (cancelled || !containerRef.current) return;
        const map = new Map(containerRef.current, {
          center: fix ?? { lat: 47.8, lng: 13.05 },
          zoom: NAV_ZOOM,
          heading: vector ? bearingDeg : 0,
          tilt: vector ? NAV_TILT : 0,
          mapId,
          disableDefaultUI: true,
          gestureHandling: "greedy",
          clickableIcons: false,
          keyboardShortcuts: false,
        });
        // "dragstart" feuert bei Google Maps JS nur aus echter Finger-/Maus-Bedienung, nie
        // aus einem programmatischen moveCamera/panTo – derselbe verlässliche Schalter
        // fürs Verlassen des Folge-Modus wie bei Mapbox (NavMap.tsx).
        map.addListener("dragstart", () => setFollowing(false));
        mapRef.current = map;
        setReady(true);
      })
      .catch(() => setMapDead(true));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey]);

  // Aufräumen beim Verlassen des Screens. Map-Objekt/Marker-Cache jetzt fassen, nicht erst
  // im Aufräumen `.current` lesen: der Ref könnte bis dahin längst eine neue Instanz
  // enthalten (dasselbe Muster wie NavMap.tsx).
  useEffect(() => {
    const stopMarkers = stopMarkersRef.current;
    return () => {
      puckRef.current?.setMap(null);
      polylineRef.current?.setMap(null);
      stopMarkers.forEach((m) => m.setMap(null));
      stopMarkers.clear();
    };
  }, []);

  // Ziel-Marker für jede Station: nummerierter Pin, die aktive Station bekommt die
  // Ziel-Flagge – dieselbe Optik/Logik wie NavMap.tsx, als kleines eigenes SVG-Icon (kein
  // DOM-Overlay wie bei Mapbox nötig: Marker-Icons reichen für die einfache Kreis+Zahl-Form).
  const stopsSig = stops.map((s) => `${s.order}:${s.lat},${s.lng}`).join("|");
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const seen = new Set<number>();
    stops.forEach((s, i) => {
      seen.add(i);
      const active = i === activeIndex;
      const icon = pinIcon(active ? "🏁" : String(s.order), active);
      let marker = stopMarkersRef.current.get(i);
      if (!marker) {
        marker = new google.maps.Marker({
          position: { lat: s.lat, lng: s.lng },
          map,
          icon,
          zIndex: active ? 20 : 10,
        });
        stopMarkersRef.current.set(i, marker);
      } else {
        marker.setPosition({ lat: s.lat, lng: s.lng });
        marker.setIcon(icon);
        marker.setZIndex(active ? 20 : 10);
      }
    });
    for (const [i, marker] of stopMarkersRef.current) {
      if (!seen.has(i)) {
        marker.setMap(null);
        stopMarkersRef.current.delete(i);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stopsSig, activeIndex, ready]);

  // Etappen-Route zeichnen.
  const routeSig = (route ?? []).map((c) => c.join(",")).join("|");
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const path = (route ?? []).map(([lng, lat]) => ({ lat, lng }));
    if (!polylineRef.current) {
      polylineRef.current = new google.maps.Polyline({
        path,
        map,
        strokeColor: "#cc2924",
        strokeOpacity: 0.92,
        strokeWeight: 5,
      });
    } else {
      polylineRef.current.setPath(path);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeSig, ready]);

  // Positions-Punkt: Pfeil-Symbol, das die Fahrtrichtung zeigt. Dreht sich NUR selbst, wenn
  // die Karte NICHT schon mitdreht (vector=false) – dreht sich die Karte bereits mit dem
  // Kurs (vector=true), muss der Pfeil auf dem Bildschirm starr nach oben zeigen, sonst
  // würde die Drehung doppelt gezählt.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !fix || !ready) return;
    const icon: google.maps.Symbol = {
      path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
      scale: 6,
      rotation: vector ? 0 : bearingDeg,
      fillColor: "#111111",
      fillOpacity: 1,
      strokeColor: "#ffffff",
      strokeWeight: 2,
    };
    if (!puckRef.current) {
      puckRef.current = new google.maps.Marker({
        position: { lat: fix.lat, lng: fix.lng },
        map,
        icon,
        zIndex: 30,
      });
    } else {
      puckRef.current.setPosition({ lat: fix.lat, lng: fix.lng });
      puckRef.current.setIcon(icon);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fix?.lng, fix?.lat, bearingDeg, ready, vector]);

  // Kamera folgt dem Kurs: ein Kamera-Sprung je akzeptiertem Fix (GPS aktualisiert ohnehin
  // nur etwa im Sekundentakt, siehe NavMap.tsx). `moveCamera`/`panTo` kennen (anders als
  // Mapbox' easeTo) kein eigenes `padding` – deshalb wird der Mittelpunkt hier selbst um die
  // Hälfte des HUD-Abstands nach Süden verschoben (offsetCenterForPadding unten), damit der
  // Positions-Punkt nicht unter dem Ankunfts-Sheet/den Leisten verschwindet. Nur eine flache
  // Näherung (rechnet nicht mit der Kamera-Neigung bei aktivem `tilt`), für diesen Test reicht
  // das.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !fix || !following || document.hidden) return;
    const center = offsetCenterForPadding(fix, paddingBottomRef.current, NAV_ZOOM);
    if (vector) {
      map.moveCamera({ center, zoom: NAV_ZOOM, heading: bearingDeg, tilt: NAV_TILT });
    } else {
      map.panTo(center);
      if (map.getZoom() !== NAV_ZOOM) map.setZoom(NAV_ZOOM);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fix?.lng, fix?.lat, bearingDeg, following, vector]);

  const recenter = () => {
    setFollowing(true);
    const map = mapRef.current;
    if (!map || !fix) return;
    const center = offsetCenterForPadding(fix, paddingBottomRef.current, NAV_ZOOM);
    if (vector) {
      map.moveCamera({ center, zoom: NAV_ZOOM, heading: bearingDeg, tilt: NAV_TILT });
    } else {
      map.panTo(center);
      map.setZoom(NAV_ZOOM);
    }
  };

  if (!apiKey) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-cream p-6 text-center text-sm text-muted">
        Karte nicht verfügbar — <code>NEXT_PUBLIC_GOOGLE_MAPS_API_KEY</code> fehlt in
        .env.local.
      </div>
    );
  }

  return (
    <div className="relative isolate h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
      {!following && fix && (
        <button
          type="button"
          onClick={recenter}
          aria-label={recenterLabel}
          style={{ top: "calc(env(safe-area-inset-top) + 10px)" }}
          className="absolute right-4 z-[47] flex h-12 w-12 items-center justify-center rounded-full bg-white/90 text-ink shadow-lg backdrop-blur-md transition active:scale-95"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M4.2 8.6V6.2a2 2 0 0 1 2-2h2.4" />
            <path d="M15.4 4.2h2.4a2 2 0 0 1 2 2v2.4" />
            <path d="M19.8 15.4v2.4a2 2 0 0 1-2 2h-2.4" />
            <path d="M8.6 19.8H6.2a2 2 0 0 1-2-2v-2.4" />
            <circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none" />
          </svg>
        </button>
      )}
      {mapDead && <MapUnavailableScreen />}
      {!ready && !mapDead && (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-cream">
          <div aria-hidden className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
        </div>
      )}
    </div>
  );
}

// Verschiebt den Kamera-Mittelpunkt um die halbe Boden-Polsterung nach Süden (Web-Mercator-
// Näherung, flach gerechnet), damit der Fix trotz fehlendem `padding`-Parameter oben im
// sichtbaren Bereich bleibt statt genau in der Mitte, wo ihn das HUD unten überdeckt.
function offsetCenterForPadding(
  fix: { lat: number; lng: number },
  paddingBottomPx: number,
  zoom: number,
): { lat: number; lng: number } {
  if (paddingBottomPx <= 0) return fix;
  const metersPerPixel = (156543.03392 * Math.cos((fix.lat * Math.PI) / 180)) / 2 ** zoom;
  const offsetDegLat = ((paddingBottomPx / 2) * metersPerPixel) / 110540;
  return { lat: fix.lat - offsetDegLat, lng: fix.lng };
}

function pinIcon(label: string, active: boolean): google.maps.Icon {
  const bg = active ? "#cc2924" : "#ffffff";
  const fg = active ? "#ffffff" : "#111111";
  const stroke = active ? "#ffffff" : "#cc2924";
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="34" height="34">` +
    `<circle cx="17" cy="17" r="14" fill="${bg}" stroke="${stroke}" stroke-width="2.5"/>` +
    `<text x="17" y="22" font-family="system-ui,-apple-system,sans-serif" font-size="13" ` +
    `font-weight="700" fill="${fg}" text-anchor="middle">${label}</text></svg>`;
  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    scaledSize: new google.maps.Size(34, 34),
    anchor: new google.maps.Point(17, 17),
  };
}
