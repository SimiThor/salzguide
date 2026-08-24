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
//     Console -> Kartenverwaltung -> Karten-ID anlegen, Kartentyp "Vektor"): echte 3D-Kamera
//     mit Neigung + Fahrtrichtung, per `map.moveCamera()` – die Mapbox-Anmutung (geneigt,
//     dreht sich mit dem Kurs). OHNE diese Variable bleibt die Karte Nord-oben (Google
//     unterstützt `tilt`/`heading` NUR auf Vector-Maps, das ist eine Google-Einschränkung,
//     keine dieser Datei) – dafür dreht sich dann wenigstens der Positions-Pfeil.
// Recherche-Ergebnis (siehe Zusammenfassung im PR/Chat): Google bietet für Web KEIN
// eigenständiges "Navigation SDK" mit eingebauter Turn-by-Turn-Führung (das gibt es nur für
// Android/iOS/Flutter) – die hier gebaute Kombination aus Maps JavaScript API + Directions
// Service + eigener Kern (bike-nav-core.ts) IST die technisch beste verfügbare Variante.
//
// OVERLAYS: Google bringt zoomControl/rotateControl (Kompass, taucht nur mit `mapId`/Neigung
// auf) selbst mit – die sind hier AN, statt sie nachzubauen ("möglichst die echte Google-
// Anmutung", siehe Testauftrag). NUR den "zur Position zurück"-Knopf gibt es in der Maps
// JavaScript API nicht eingebaut (das ist ein Feature der Google-Maps-App, nicht der
// Web-API) – der wird hier als EIGENE Custom Control gebaut, aber über Googles eigenes
// `map.controls[...]`-Regal eingehängt statt als React-Overlay über der Karte zu schweben:
// so reiht Google ihn optisch selbst neben seine eigenen Knöpfe ein (Marge, Schatten,
// Anordnung), statt dass zwei verschiedene Knopf-Stile nebeneinander stehen.
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
  const recenterBtnRef = useRef<HTMLButtonElement | null>(null);
  const [ready, setReady] = useState(false);
  const [mapDead, setMapDead] = useState(false);
  const [following, setFollowing] = useState(true);
  const paddingBottomRef = useLatestRef(paddingBottom);
  const fixRef = useLatestRef(fix);
  const bearingRef = useLatestRef(bearingDeg);
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
          gestureHandling: "greedy",
          clickableIcons: false,
          keyboardShortcuts: false,
          // Googles EIGENE Bedienelemente an, statt sie nachzubauen (siehe Datei-Kopf).
          // mapTypeControl/streetViewControl/fullscreenControl bleiben aus: Satelliten-
          // Ansicht, Pegman und Vollbild passen nicht auf eine Bike-Nav-HUD-Fläche.
          disableDefaultUI: false,
          zoomControl: true,
          zoomControlOptions: { position: google.maps.ControlPosition.RIGHT_CENTER },
          rotateControl: true,
          rotateControlOptions: { position: google.maps.ControlPosition.RIGHT_CENTER },
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
        });
        // "dragstart" feuert bei Google Maps JS nur aus echter Finger-/Maus-Bedienung, nie
        // aus einem programmatischen moveCamera/panTo – derselbe verlässliche Schalter
        // fürs Verlassen des Folge-Modus wie bei Mapbox (NavMap.tsx).
        map.addListener("dragstart", () => setFollowing(false));

        // "Zur Position zurück"-Knopf: die EINE Sache, die Googles eigene Bedienelemente
        // nicht mitbringen (siehe Datei-Kopf) – als echte Google-Control eingehängt, damit
        // er optisch neben Zoom/Kompass steht statt als eigenes Overlay darüber zu schweben.
        const btn = document.createElement("button");
        btn.type = "button";
        btn.setAttribute("aria-label", recenterLabel);
        btn.style.cssText =
          "display:none;width:40px;height:40px;margin:8px;border:0;border-radius:2px;" +
          "background:#fff;box-shadow:0 1px 4px -1px rgba(0,0,0,0.3);cursor:pointer;" +
          "align-items:center;justify-content:center;";
        btn.innerHTML =
          '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#111" ' +
          'stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
          '<path d="M4.2 8.6V6.2a2 2 0 0 1 2-2h2.4"/><path d="M15.4 4.2h2.4a2 2 0 0 1 2 2v2.4"/>' +
          '<path d="M19.8 15.4v2.4a2 2 0 0 1-2 2h-2.4"/><path d="M8.6 19.8H6.2a2 2 0 0 1-2-2v-2.4"/>' +
          '<circle cx="12" cy="12" r="2.5" fill="#111" stroke="none"/></svg>';
        btn.addEventListener("click", () => {
          setFollowing(true);
          const f = fixRef.current;
          if (!f) return;
          const center = offsetCenterForPadding(f, paddingBottomRef.current, NAV_ZOOM);
          if (vector) {
            map.moveCamera({ center, zoom: NAV_ZOOM, heading: bearingRef.current, tilt: NAV_TILT });
          } else {
            map.panTo(center);
            map.setZoom(NAV_ZOOM);
          }
        });
        recenterBtnRef.current = btn;
        map.controls[google.maps.ControlPosition.RIGHT_CENTER].push(btn);

        mapRef.current = map;
        setReady(true);
      })
      .catch(() => setMapDead(true));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey]);

  // Knopf nur sichtbar, wenn die Kamera nicht (mehr) folgt – dasselbe Verhalten wie zuvor
  // als React-Overlay, nur jetzt an Googles eigenem DOM-Knoten statt an JSX.
  useEffect(() => {
    const btn = recenterBtnRef.current;
    if (btn) btn.style.display = !following && fix ? "flex" : "none";
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [following, fix?.lng, fix?.lat]);

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
