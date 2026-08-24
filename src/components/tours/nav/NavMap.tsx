"use client";

import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { useEffect, useRef, useState } from "react";
import { MapLoadingScreen, useMapLoading } from "@/components/MapLoading";
import { MapUnavailableScreen, tryCreateMap } from "@/components/MapUnavailable";
import { useLatestRef } from "@/lib/use-latest-ref";
import { declutterBasemap } from "@/lib/map-declutter";
import {
  addRouteSourceAndLayers,
  setTrim,
  routeFC,
  ROUTE_SOURCE,
  reducedMotion,
} from "@/lib/route-anim";

const TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
const NAV_PITCH = 58;
const NAV_ZOOM = 17;
const FOLLOW_EASE_MS = 1000;
const RECENTER_EASE_MS = 500;

// Eigene, schlanke Mapbox-Karte NUR für die S-Bike-Turn-by-Turn-Navigation. BEWUSST
// keine SpotMap-Variante (siehe docs/40): SpotMap ist für seine ~15 Aufrufer auf eine
// flache 2D-Kamera (pitch:0/maxPitch:0), fitBounds-Einpassen und ein Kamera-Gedächtnis
// (viewKey) festgelegt. Hier ist fast alles davon umgekehrt: geneigte, dauerhaft dem
// Fahrtkurs folgende Kamera, die NIE einen gespeicherten Ausschnitt wiederherstellt und
// bei jedem GPS-Fix neu zentriert. Beide Regime in eine Komponente zu zwingen hätte
// jeden bestehenden SpotMap-Aufrufer riskiert – die paar geteilten Bausteine
// (tryCreateMap, declutterBasemap, die Routen-Layer, der Ladeschirm) kommen von dort.
export type NavStopPoint = { lat: number; lng: number; order: number };

export default function NavMap({
  route,
  fix,
  bearingDeg,
  stops,
  activeIndex,
  paddingBottom = 0,
  recenterLabel,
}: {
  route: [number, number][] | null;
  fix: { lng: number; lat: number } | null;
  bearingDeg: number;
  // ALLE Stationen der Runde, nicht nur die aktuell angesteuerte – "ein Zielpunkt für
  // jede Navigation": man soll die ganze Kette der Ziele sehen, nicht erst eins, sobald
  // man in seiner Nähe ist. Der Punkt bei `activeIndex` bekommt die Ziel-Flagge, alle
  // anderen ihre Nummer (gleiche Optik wie die nummerierten Pins auf TourView).
  stops: NavStopPoint[];
  activeIndex: number;
  // Platz unten (px), den z.B. das Ankunfts-Sheet oder die HUD-Leisten brauchen —
  // fliesst als Kamera-Padding ein, damit der Punkt nicht darunter verschwindet.
  paddingBottom?: number;
  recenterLabel: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const puckRef = useRef<mapboxgl.Marker | null>(null);
  const stopMarkersRef = useRef<Map<number, mapboxgl.Marker>>(new Map());
  const { bindMap, loading } = useMapLoading();
  const [mapDead, setMapDead] = useState(false);
  const [following, setFollowing] = useState(true);
  const paddingBottomRef = useLatestRef(paddingBottom);

  // Karte einmalig aufbauen.
  useEffect(() => {
    if (!TOKEN || !containerRef.current || mapRef.current) return;
    mapboxgl.accessToken = TOKEN;
    const map = tryCreateMap({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/outdoors-v12",
      center: fix ? [fix.lng, fix.lat] : [13.05, 47.8],
      zoom: NAV_ZOOM,
      bearing: bearingDeg,
      pitch: NAV_PITCH,
      maxPitch: 60,
      pitchWithRotate: false,
      touchPitch: false,
      attributionControl: false,
    });
    if (!map) {
      setMapDead(true);
      return;
    }
    map.addControl(new mapboxgl.AttributionControl({ compact: true }));
    declutterBasemap(map);
    map.on("load", () => {
      addRouteSourceAndLayers(map, []);
      // Kein Zeichnen-Draw-in wie auf den Übersichtskarten: Im HUD steht die Linie
      // sofort, ihre Animation würde vom eigentlichen Signal (wohin geht's) ablenken.
      setTrim(map, 1);
    });
    // "dragstart" feuert in Mapbox GL JS AUSSCHLIESSLICH aus der eingebauten
    // Zieh-Bedienung (Finger/Maus) – ein programmatischer easeTo/flyTo löst es nie
    // aus. Genau deshalb eignet es sich hier als der EINE Schalter fürs Verlassen des
    // Folge-Modus, ohne die eigenen Kamera-Bewegungen fälschlich mitzuzählen.
    const onDragStart = () => setFollowing(false);
    map.on("dragstart", onDragStart);
    const unbindLoading = bindMap(map);
    mapRef.current = map;
    // Map-Objekt jetzt fassen, nicht erst beim Aufräumen `.current` lesen: Der Ref
    // könnte bis dahin (Unmount) längst eine neue Map enthalten.
    const stopMarkers = stopMarkersRef.current;
    return () => {
      map.off("dragstart", onDragStart);
      unbindLoading();
      puckRef.current?.remove();
      stopMarkers.forEach((m) => m.remove());
      stopMarkers.clear();
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ziel-Marker für JEDE Station der Runde – nicht nur die gerade angesteuerte (siehe
  // NavStopPoint oben). Gleicher Aufbau wie die nummerierten Pins auf TourView/SpotMap,
  // damit ein Stopp überall gleich aussieht: die aktive Station (activeIndex, 0-basiert
  // wie bike.currentStopIndex) trägt die Ziel-Flagge, alle anderen ihre echte Nummer
  // (s.order, 1-basiert). Schlüssel im Marker-Cache ist die ARRAY-Position, nicht
  // s.order – beide fallen normalerweise zusammen, aber activeIndex vergleicht gegen
  // die Position, nicht die Beschriftung.
  const stopsSig = stops.map((s) => `${s.order}:${s.lat},${s.lng}`).join("|");
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const seen = new Set<number>();
    stops.forEach((s, i) => {
      seen.add(i);
      const active = i === activeIndex;
      let marker = stopMarkersRef.current.get(i);
      if (!marker) {
        const wrap = document.createElement("div");
        wrap.className = "sg-pin";
        const inner = document.createElement("span");
        inner.className = "sg-marker";
        wrap.appendChild(inner);
        marker = new mapboxgl.Marker({ element: wrap }).setLngLat([s.lng, s.lat]).addTo(map);
        stopMarkersRef.current.set(i, marker);
      } else {
        marker.setLngLat([s.lng, s.lat]);
      }
      const el = marker.getElement();
      el.classList.toggle("sg-pin--active", active);
      const inner = el.querySelector(".sg-marker") as HTMLElement | null;
      if (inner) {
        inner.classList.toggle("sg-marker--num", !active);
        inner.textContent = active ? "🏁" : String(s.order);
      }
    });
    // Marker von Stationen entfernen, die es nicht mehr gibt (sollte praktisch nie
    // vorkommen – die Stationenliste einer laufenden Runde ändert sich nicht).
    for (const [i, marker] of stopMarkersRef.current) {
      if (!seen.has(i)) {
        marker.remove();
        stopMarkersRef.current.delete(i);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stopsSig, activeIndex]);

  // Etappen-Route zeichnen (ersetzt die Linie komplett – neue Etappe = neue Geometrie).
  const routeSig = (route ?? []).map((c) => c.join(",")).join("|");
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const src = map.getSource(ROUTE_SOURCE) as mapboxgl.GeoJSONSource | undefined;
    if (!src) return;
    src.setData(routeFC(route ?? []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeSig]);

  // Positions-Punkt: eigener DOM-Marker statt GeolocateControl. GeolocateControl zeigt
  // nur seinen eigenen internen Fix an und gibt der App keinen Zugriff auf den
  // Fix-Strom, den die Kamera unten braucht – hier ist der Fix ohnehin schon da
  // (useGeolocationWatch), der Marker folgt ihm nur.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !fix) return;
    if (!puckRef.current) {
      const el = document.createElement("div");
      el.className = "sg-nav-puck";
      puckRef.current = new mapboxgl.Marker({ element: el, rotationAlignment: "viewport" })
        .setLngLat([fix.lng, fix.lat])
        .addTo(map);
    } else {
      puckRef.current.setLngLat([fix.lng, fix.lat]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fix?.lng, fix?.lat]);

  // Kamera folgt dem Kurs: EIN easeTo je akzeptiertem Fix, verkettet statt als
  // rAF-Dauerschleife – GPS aktualisiert ohnehin nur etwa im Sekundentakt, ein Frame
  // pro Fix reicht für die Google-Maps-Anmutung und kostet nichts, solange nichts
  // Neues hereinkommt. Pausiert im Hintergrund-Tab (Akku) und sobald der Nutzer selbst
  // verschoben hat (following=false, siehe dragstart oben).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !fix || !following || document.hidden) return;
    map.easeTo({
      center: [fix.lng, fix.lat],
      bearing: bearingDeg,
      pitch: NAV_PITCH,
      zoom: NAV_ZOOM,
      // "Bewegung reduzieren": Sprung statt Gleiten. essential:true (unten) sorgt zwar
      // dafür, dass Mapbox die Bewegung nicht selbst kürzt, aber ein wiederkehrendes
      // Gleiten bei jedem Fix ist genau die Art Dauerbewegung, die die Einstellung
      // eigentlich abstellen soll – deshalb hier explizit auf 0 statt Mapbox' eigene
      // (kürzere, aber nicht abgeschaltete) Reduzierung zu verlassen.
      duration: reducedMotion() ? 0 : FOLLOW_EASE_MS,
      easing: (t) => t,
      padding: { top: 0, right: 0, left: 0, bottom: paddingBottomRef.current },
      essential: true,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fix?.lng, fix?.lat, bearingDeg, following]);

  const recenter = () => {
    setFollowing(true);
    const map = mapRef.current;
    if (map && fix) {
      map.easeTo({
        center: [fix.lng, fix.lat],
        bearing: bearingDeg,
        pitch: NAV_PITCH,
        zoom: NAV_ZOOM,
        duration: reducedMotion() ? 0 : RECENTER_EASE_MS,
        padding: { top: 0, right: 0, left: 0, bottom: paddingBottomRef.current },
        essential: true,
      });
    }
  };

  if (!TOKEN) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-cream p-6 text-center text-sm text-muted">
        Karte nicht verfügbar — <code>NEXT_PUBLIC_MAPBOX_TOKEN</code> fehlt in .env.local.
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
          // Oben rechts, auf derselben Höhe wie der Beenden-Knopf oben links
          // (BikeNavScreen.tsx: calc(env(safe-area-inset-top) + 10px)) – bewusst NICHT
          // mehr unten, das lag zu nah an der Ankunfts-Leiste/dem Sheet und wanderte
          // mit deren wechselnder Höhe (paddingBottom) ständig mit.
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
      {mapDead ? <MapUnavailableScreen /> : <MapLoadingScreen {...loading} />}
    </div>
  );
}
