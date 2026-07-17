"use client";

import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { useEffect, useRef, useState } from "react";
import { RecenterControl } from "../mapControls";
import type { MapPoi } from "@/lib/geo";
import { poiEmoji, poiDeLabel } from "@/lib/poi";

const TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
type Pt = { lat: number; lng: number } | null;

// Welcher Punkt wird gerade auf der Karte gesetzt? null = normaler Modus (Spot/Route).
// Parkplatz ist einmalig (ein Klick, dann fertig), Wasser/Hütte sammeln (Modus bleibt).
export type PlacingKind = "parking" | "water" | "hut" | null;

// Darstellung der Zusatzpunkt-Typen an EINER Stelle -> Admin und (analog) User-Karte
// bleiben einheitlich, Farbe/Symbol nie doppelt gepflegt.
export const POI_STYLE: Record<"water" | "hut", { emoji: string; color: string; label: string }> = {
  water: { emoji: "💧", color: "#0ea5e9", label: "Wasserstelle" },
  hut: { emoji: "🛖", color: "#b45309", label: "Hütte" },
};

function fc(coords: [number, number][]) {
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

// Eine Karte mit EINEM klaren Standardzweck:
//  - mode "route": Klick setzt Wegpunkte (Start → Ziel)
//  - mode "point": Klick setzt den Spot-Punkt
// Der Parkplatz wird NUR gesetzt, wenn placingParking=true (eigener Schritt im Formular)
// -> ein Klick setzt ihn, danach meldet onParkingPlaced() das Ende des Schritts.
export default function LocationPicker({
  mode,
  spot,
  parking,
  route,
  line,
  placing,
  waterStops,
  huts,
  onSet,
  onRouteChange,
  onPoiChange,
  onExitPlacing,
}: {
  mode: "point" | "route";
  spot: Pt;
  parking: Pt;
  route: [number, number][];
  line: [number, number][];
  placing: PlacingKind;
  waterStops: MapPoi[];
  huts: MapPoi[];
  onSet: (which: "spot" | "parking", lat: number | null, lng: number | null) => void;
  onRouteChange: (coords: [number, number][]) => void;
  onPoiChange: (kind: "water" | "hut", pois: MapPoi[]) => void;
  // Beendet den (einmaligen) Setz-Schritt, z.B. nach dem Parkplatz-Klick.
  onExitPlacing: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const pointMarkers = useRef<Record<"spot" | "parking", mapboxgl.Marker | null>>({
    spot: null,
    parking: null,
  });
  const routeMarkers = useRef<mapboxgl.Marker[]>([]);
  const poiMarkers = useRef<mapboxgl.Marker[]>([]);

  const onSetRef = useRef(onSet);
  onSetRef.current = onSet;
  const onRouteRef = useRef(onRouteChange);
  onRouteRef.current = onRouteChange;
  const onPoiRef = useRef(onPoiChange);
  onPoiRef.current = onPoiChange;
  const onExitPlacingRef = useRef(onExitPlacing);
  onExitPlacingRef.current = onExitPlacing;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const placingRef = useRef(placing);
  placingRef.current = placing;
  const waterRef = useRef(waterStops);
  waterRef.current = waterStops;
  const hutRef = useRef(huts);
  hutRef.current = huts;
  const routeRef = useRef(route);
  routeRef.current = route;
  const lineRef = useRef(line);
  lineRef.current = line;
  const spotRef = useRef(spot);
  spotRef.current = spot;
  const parkingRef = useRef(parking);
  parkingRef.current = parking;

  // "Zentrieren": auf alle relevanten Punkte/die Route zoomen
  const recenterRef = useRef<() => void>(() => {});
  recenterRef.current = () => {
    const map = mapRef.current;
    if (!map) return;
    const coords: [number, number][] = [];
    if (lineRef.current.length >= 2) coords.push(...lineRef.current);
    else if (routeRef.current.length) coords.push(...routeRef.current);
    if (spotRef.current) coords.push([spotRef.current.lng, spotRef.current.lat]);
    if (parkingRef.current) coords.push([parkingRef.current.lng, parkingRef.current.lat]);
    for (const p of waterRef.current) coords.push([p.lng, p.lat]);
    for (const p of hutRef.current) coords.push([p.lng, p.lat]);
    if (coords.length === 0) return;
    if (coords.length === 1) {
      map.flyTo({ center: coords[0], zoom: Math.max(map.getZoom(), 14), duration: 500 });
      return;
    }
    const b = new mapboxgl.LngLatBounds();
    coords.forEach((c) => b.extend(c));
    map.fitBounds(b, { padding: 60, maxZoom: 15, duration: 500 });
  };

  // Orts-/POI-Suche (Mapbox Search Box API), auf Österreich/Salzburg gebiast
  type Hit = { name: string; detail: string; center: [number, number]; poi: boolean };
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Hit[]>([]);
  const reqRef = useRef(0);
  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) {
      setResults([]);
      return;
    }
    const id = ++reqRef.current;
    const timer = setTimeout(async () => {
      try {
        const url = `https://api.mapbox.com/search/searchbox/v1/forward?q=${encodeURIComponent(
          query,
        )}&access_token=${TOKEN}&language=de&country=at&proximity=13.05,47.6&limit=6`;
        const res = await fetch(url);
        const data = await res.json();
        if (id !== reqRef.current) return;
        const feats = (data.features ?? []) as {
          properties?: { name?: string; place_formatted?: string; feature_type?: string };
          geometry?: { coordinates?: [number, number] };
        }[];
        setResults(
          feats
            .filter((f) => f.geometry?.coordinates)
            .map((f) => ({
              name: f.properties?.name ?? "",
              detail: f.properties?.place_formatted ?? "",
              center: f.geometry!.coordinates!,
              poi: f.properties?.feature_type === "poi",
            })),
        );
      } catch {
        if (id === reqRef.current) setResults([]);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [q]);

  function goTo(center: [number, number]) {
    mapRef.current?.flyTo({ center, zoom: 14, duration: 800 });
    setResults([]);
    setQ("");
  }

  useEffect(() => {
    if (!TOKEN || !ref.current || mapRef.current) return;
    mapboxgl.accessToken = TOKEN;
    const map = new mapboxgl.Map({
      container: ref.current,
      style: "mapbox://styles/mapbox/outdoors-v12",
      center: [13.05, 47.6],
      zoom: 9,
      cooperativeGestures: true,
      // Immer flache 2D-Ansicht — keine 3D-Neigung (Pitch)
      pitch: 0,
      maxPitch: 0,
      pitchWithRotate: false,
      touchPitch: false,
    });
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");
    map.addControl(new RecenterControl(() => recenterRef.current()), "top-right");
    map.on("load", () => {
      map.addSource("sg-route", { type: "geojson", data: fc(lineRef.current) });
      map.addLayer({
        id: "sg-route-out",
        type: "line",
        source: "sg-route",
        paint: { "line-color": "#ffffff", "line-width": 6.5 },
        layout: { "line-join": "round", "line-cap": "round" },
      });
      map.addLayer({
        id: "sg-route-line",
        type: "line",
        source: "sg-route",
        paint: { "line-color": "#e04848", "line-width": 3.5 },
        layout: { "line-join": "round", "line-cap": "round" },
      });
      // Beim Öffnen (v.a. Bearbeiten) automatisch auf alle gesetzten Punkte/Route einpassen
      recenterRef.current();
    });
    map.on("click", (ev) => {
      const { lng, lat } = ev.lngLat;
      const p = placingRef.current;
      if (p === "parking") {
        // Einmaliger Schritt: ein Klick setzt den Parkplatz, dann fertig.
        onSetRef.current("parking", lat, lng);
        onExitPlacingRef.current();
      } else if (p === "water") {
        // Sammeln: jeder Klick hängt eine Wasserstelle an, Modus bleibt aktiv.
        onPoiRef.current("water", [...waterRef.current, { lng, lat }]);
      } else if (p === "hut") {
        onPoiRef.current("hut", [...hutRef.current, { lng, lat }]);
      } else if (modeRef.current === "route") {
        onRouteRef.current([...routeRef.current, [lng, lat]]);
      } else {
        onSetRef.current("spot", lat, lng);
      }
    });
    mapRef.current = map;
    return () => {
      // Marker gehören zur zerstörten Karte. Refs leeren (und Marker entfernen),
      // damit sie beim Neu-Mounten (z. B. Client-Navigation aus dem Menü) auf der
      // NEUEN Karte frisch erstellt werden statt auf der toten hängen zu bleiben.
      pointMarkers.current.spot?.remove();
      pointMarkers.current.parking?.remove();
      pointMarkers.current = { spot: null, parking: null };
      routeMarkers.current.forEach((m) => m.remove());
      routeMarkers.current = [];
      poiMarkers.current.forEach((m) => m.remove());
      poiMarkers.current = [];
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Einzelpunkte (Spot/Parkplatz) — immer über den Routen-Markern (z-index)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const pts: Record<"spot" | "parking", Pt> = { spot, parking };
    (Object.keys(pts) as ("spot" | "parking")[]).forEach((w) => {
      const p = pts[w];
      if (p) {
        if (!pointMarkers.current[w]) {
          const el = document.createElement("div");
          if (w === "parking") {
            el.style.cssText =
              "display:flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:9999px;border:2px solid #fff;box-shadow:0 1px 5px rgba(0,0,0,.45);background:#2563eb;color:#fff;font-size:12px;font-weight:700;cursor:grab";
            el.textContent = "P";
          } else {
            el.style.cssText =
              "width:20px;height:20px;border-radius:9999px;border:3px solid #fff;box-shadow:0 1px 5px rgba(0,0,0,.45);background:#cc2924;cursor:grab";
          }
          // Einheitliche Höhen-Ordnung (oben = wichtiger): Wegpunkte 2 < Ziel 3 <
          // Start 4 < POIs 5 < Parkplatz 6 < Spot 7. So verdeckt nichts das Wichtigere.
          el.style.zIndex = w === "parking" ? "6" : "7";
          const m = new mapboxgl.Marker({ element: el, draggable: true })
            .setLngLat([p.lng, p.lat])
            .addTo(map);
          m.on("dragend", () => {
            const ll = m.getLngLat();
            onSetRef.current(w, ll.lat, ll.lng);
          });
          pointMarkers.current[w] = m;
        } else {
          pointMarkers.current[w]!.setLngLat([p.lng, p.lat]);
        }
      } else {
        pointMarkers.current[w]?.remove();
        pointMarkers.current[w] = null;
      }
    });
  }, [spot, parking]);

  // Route: Linie + ziehbare Kontrollpunkt-Marker (Start immer über Ziel)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const src = map.getSource("sg-route") as mapboxgl.GeoJSONSource | undefined;
    if (src) src.setData(fc(line));

    routeMarkers.current.forEach((m) => m.remove());
    routeMarkers.current = [];
    route.forEach(([lng, lat], i) => {
      const isStart = i === 0;
      const isEnd = i === route.length - 1 && route.length > 1;
      const el = document.createElement("div");
      el.style.cssText =
        "display:flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:9999px;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4);font-size:11px;color:#fff;cursor:grab;background:" +
        (isStart ? "#16a34a" : isEnd ? "#cc2924" : "#6b7280");
      el.textContent = isStart ? "🥾" : isEnd ? "🏁" : String(i + 1);
      // Start 4 über Ziel 3 über den nummerierten Wegpunkten 2 (siehe Ordnung oben).
      el.style.zIndex = isStart ? "4" : isEnd ? "3" : "2";
      const m = new mapboxgl.Marker({ element: el, draggable: true })
        .setLngLat([lng, lat])
        .addTo(map);
      m.on("dragend", () => {
        const ll = m.getLngLat();
        const next = routeRef.current.map((c, idx) =>
          idx === i ? ([ll.lng, ll.lat] as [number, number]) : c,
        );
        onRouteRef.current(next);
      });
      routeMarkers.current.push(m);
    });
  }, [route, line]);

  // Zusatzpunkte (Wasserstellen, Hütten): ziehbare Emoji-Marker, beide Typen in einem
  // Effekt neu aufgebaut. Ziehen aktualisiert nur den einen Punkt (Name bleibt erhalten).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    poiMarkers.current.forEach((m) => m.remove());
    poiMarkers.current = [];
    const kinds: ["water" | "hut", MapPoi[]][] = [
      ["water", waterStops],
      ["hut", huts],
    ];
    for (const [kind, pois] of kinds) {
      const style = POI_STYLE[kind];
      pois.forEach((p, i) => {
        const el = document.createElement("div");
        el.style.cssText =
          "display:flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:9999px;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4);font-size:12px;cursor:grab;background:" +
          style.color;
        // Symbol richtet sich nach dem Untertyp (z.B. 🚰 Trinkbrunnen), wie auf der
        // User-Karte -> Admin und User sehen dasselbe.
        el.textContent = poiEmoji(kind, p.subtype);
        const label = poiDeLabel(kind, p.subtype);
        el.title = p.name ? `${label}: ${p.name}` : label;
        // POIs über den Routen-Markern, unter Parkplatz/Spot (siehe Ordnung oben).
        el.style.zIndex = "5";
        const m = new mapboxgl.Marker({ element: el, draggable: true })
          .setLngLat([p.lng, p.lat])
          .addTo(map);
        m.on("dragend", () => {
          const ll = m.getLngLat();
          const arr = kind === "water" ? waterRef.current : hutRef.current;
          const next = arr.map((c, idx) =>
            idx === i ? { ...c, lng: ll.lng, lat: ll.lat } : c,
          );
          onPoiRef.current(kind, next);
        });
        poiMarkers.current.push(m);
      });
    }
  }, [waterStops, huts]);

  if (!TOKEN) {
    return (
      <div className="flex h-72 items-center justify-center rounded-[14px] bg-black/5 text-sm text-muted">
        Karte nicht verfügbar (Mapbox-Token fehlt).
      </div>
    );
  }

  // Farbe/Text des aktiven Setz-Schritts an einer Stelle.
  const placingInfo =
    placing === "parking"
      ? { color: "#2563eb", banner: "📍 Parkplatz: Ort auf der Karte antippen", hint: "📍 Tippe jetzt den Parkplatz auf der Karte." }
      : placing === "water"
        ? { color: POI_STYLE.water.color, banner: `${POI_STYLE.water.emoji} Wasserstellen antippen (mehrere möglich)`, hint: `${POI_STYLE.water.emoji} Tippe Wasserstellen auf die Karte. Fertig-Knopf beendet.` }
        : placing === "hut"
          ? { color: POI_STYLE.hut.color, banner: `${POI_STYLE.hut.emoji} Hütten antippen (mehrere möglich)`, hint: `${POI_STYLE.hut.emoji} Tippe Hütten auf die Karte. Fertig-Knopf beendet.` }
          : null;

  const hint = placingInfo
    ? placingInfo.hint
    : mode === "route"
      ? "Auf die Karte tippen setzt Start → Wegpunkte → Ziel. Marker ziehen verschiebt sie."
      : "Auf die Karte tippen setzt den Spot-Punkt (Marker ziehen verschiebt ihn).";

  return (
    <div>
      <div className="relative">
        <div ref={ref} className="h-72 w-full overflow-hidden rounded-[14px]" />

        {/* Ortssuche */}
        <div className="absolute left-2 top-2 w-[min(280px,72%)]">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (results[0]) goTo(results[0].center);
              }
            }}
            placeholder="Ort/POI suchen (z. B. Café Bazar)…"
            className="w-full rounded-full border border-black/10 bg-white/95 px-3.5 py-2 text-sm text-ink shadow-sm outline-none backdrop-blur focus:border-accent"
          />
          {results.length > 0 && (
            <ul className="mt-1 overflow-hidden rounded-[12px] border border-black/10 bg-white shadow-lg">
              {results.map((r, i) => (
                <li key={i}>
                  <button
                    type="button"
                    onClick={() => goTo(r.center)}
                    className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-black/5"
                  >
                    <span className="mt-0.5 shrink-0 text-xs">{r.poi ? "📍" : "🗺️"}</span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-ink">{r.name}</span>
                      {r.detail && (
                        <span className="block truncate text-xs text-muted">{r.detail}</span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Deutliches Banner im aktiven Setz-Schritt (Parkplatz/Wasser/Hütte) */}
        {placingInfo && (
          <div className="pointer-events-none absolute inset-x-0 top-2 flex justify-center">
            <span
              className="rounded-full px-3.5 py-1.5 text-sm font-semibold text-white shadow-md"
              style={{ background: placingInfo.color }}
            >
              {placingInfo.banner}
            </span>
          </div>
        )}
      </div>

      <p
        className="mt-1.5 text-xs"
        style={placingInfo ? { color: placingInfo.color, fontWeight: 500 } : undefined}
      >
        <span className={placingInfo ? "" : "text-muted"}>{hint}</span>
      </p>
    </div>
  );
}
