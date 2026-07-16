"use client";

import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { useEffect, useRef } from "react";
import { RecenterControl, FullscreenControl } from "./mapControls";

export type MapMarker = {
  slug: string;
  lat: number;
  lng: number;
  emoji?: string | null;
  locked?: boolean;
  title?: string;
  imageUrl?: string | null; // nur für die Vorschau-Karte (MapCard), Pin nutzt Emoji
};

const TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

// Wiederverwendbare, vollflächige Mapbox-Karte (docs/02 §8, docs/10).
// Emoji-Kreis-Marker (🤫 wenn locked), fitBounds, Navigation + Geolocate.
type Padding = { top?: number; right?: number; bottom?: number; left?: number };

function routeFC(coords: [number, number][]) {
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

export default function SpotMap({
  markers,
  onMarkerClick,
  selectedSlug,
  center = [13.05, 47.6],
  zoom = 8,
  padding,
  cooperative = false,
  focus,
  onMapClick,
  route,
  showRouteEnds = true,
  fitRoute = true,
  highlight,
  onFullscreen,
  mapClass,
}: {
  markers: MapMarker[];
  onMarkerClick?: (slug: string) => void;
  // Slug des ausgewählten Spots -> Pin wird hervorgehoben (Scale + Pulse-Ring)
  selectedSlug?: string | null;
  onMapClick?: () => void;
  route?: [number, number][] | null;
  // Route-Zeichnung: Start/Ziel-Marker anzeigen? Auf die Route einpassen?
  // Explore (Übersichtskarte) setzt beide auf false -> nur die Linie.
  showRouteEnds?: boolean;
  fitRoute?: boolean;
  center?: [number, number];
  zoom?: number;
  // Asymmetrisches Padding für fitBounds, damit z.B. das Bottom-Sheet (Mobile)
  // oder die Sidebar (Desktop) die Marker nicht verdeckt.
  padding?: Padding;
  // cooperativeGestures: Seiten-Scroll geht durch; Karte zoomt nur mit Cmd/Strg+Scroll
  // bzw. zwei Fingern. Für eingebettete Karten (Detailseite), damit nichts verrutscht.
  cooperative?: boolean;
  // Sanft auf einen Punkt fliegen; padBottom hält unten Platz frei,
  // damit der Spot ÜBER der Vorschau-Karte/dem Sheet sitzt.
  // bounds = Routen-Bounding-Box [minLng,minLat,maxLng,maxLat]: liegt sofort vor,
  // daher EIN Zoom auf den End-Ausschnitt ohne aufs Nachladen der Linie zu warten.
  focus?: {
    lng: number;
    lat: number;
    padTop?: number;
    padBottom?: number;
    route?: [number, number][];
    bounds?: [number, number, number, number];
  } | null;
  // Dezenter Punkt entlang der Route (Sync mit dem Höhenprofil)
  highlight?: [number, number] | null;
  // Wenn gesetzt: Vollbild-Button anzeigen, Klick ruft den Callback
  onFullscreen?: () => void;
  // Zusätzliche CSS-Klasse am Karten-Container (steuert u.a. Control-Position mobil)
  mapClass?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markerObjs = useRef<mapboxgl.Marker[]>([]);
  const hlMarker = useRef<mapboxgl.Marker | null>(null);
  const onFullscreenRef = useRef(onFullscreen);
  onFullscreenRef.current = onFullscreen;

  // Aktuelle Marker/Padding für den Zentrieren-Button (liest immer den neuesten Stand)
  const markersRef = useRef(markers);
  markersRef.current = markers;
  // Marker-DOM-Elemente pro Slug + ausgewählter Spot (für die Hervorhebung)
  const markerEls = useRef<Map<string, HTMLElement>>(new Map());
  const selectedRef = useRef(selectedSlug);
  selectedRef.current = selectedSlug;
  const paddingRef = useRef(padding);
  paddingRef.current = padding;
  const onMapClickRef = useRef(onMapClick);
  onMapClickRef.current = onMapClick;
  const recenterRef = useRef<() => void>(() => {});
  recenterRef.current = () => {
    const map = mapRef.current;
    if (!map) return;
    // Wanderung: auf die Route zoomen
    const r = routeRef.current ?? [];
    if (r.length >= 2) {
      const rb = new mapboxgl.LngLatBounds();
      r.forEach((c) => rb.extend(c));
      const pad = paddingRef.current;
      map.fitBounds(rb, {
        padding: {
          top: pad?.top ?? 60,
          right: pad?.right ?? 60,
          bottom: pad?.bottom ?? 60,
          left: pad?.left ?? 60,
        },
        maxZoom: 15,
        duration: 600,
      });
      return;
    }
    const valid = markersRef.current.filter((m) => m.lat != null && m.lng != null);
    if (valid.length === 0) return;
    if (valid.length === 1) {
      map.flyTo({
        center: [valid[0].lng, valid[0].lat],
        zoom: Math.max(map.getZoom(), 13),
        duration: 600,
      });
      return;
    }
    const b = new mapboxgl.LngLatBounds();
    for (const m of valid) b.extend([m.lng, m.lat]);
    const p = paddingRef.current;
    map.fitBounds(b, {
      padding: {
        top: p?.top ?? 90,
        right: p?.right ?? 90,
        bottom: p?.bottom ?? 90,
        left: p?.left ?? 90,
      },
      maxZoom: 13,
      duration: 600,
    });
  };

  // Route (Wanderweg) zeichnen
  const routeRef = useRef(route);
  routeRef.current = route;
  const showRouteEndsRef = useRef(showRouteEnds);
  showRouteEndsRef.current = showRouteEnds;
  const fitRouteRef = useRef(fitRoute);
  fitRouteRef.current = fitRoute;
  const routeMarkers = useRef<mapboxgl.Marker[]>([]);
  const routeSig = (route ?? []).map((c) => c.join(",")).join("|");
  const drawRouteRef = useRef<() => void>(() => {});
  drawRouteRef.current = () => {
    const map = mapRef.current;
    if (!map) return;
    const src = map.getSource("sg-route") as mapboxgl.GeoJSONSource | undefined;
    if (!src) return;
    const r = routeRef.current ?? [];
    src.setData(routeFC(r));
    routeMarkers.current.forEach((m) => m.remove());
    routeMarkers.current = [];
    if (r.length >= 2) {
      // Start/Ziel-Marker (auf der Übersichtskarte aus -> nur die Linie)
      if (showRouteEndsRef.current) {
        // Ziel zuerst (darunter), Start zuletzt + höherer z-index -> Start liegt
        // immer ÜBER dem Ziel (wichtig bei Rundwegen, wo Start ≈ Ziel).
        const ends: [[number, number], string, number][] = [
          [r[r.length - 1], "🏁", 2],
          [r[0], "🥾", 4],
        ];
        for (const [c, emoji, z] of ends) {
          const wrap = document.createElement("div");
          wrap.className = "sg-pin";
          wrap.style.zIndex = String(z);
          const inner = document.createElement("div");
          inner.className = "sg-marker";
          inner.textContent = emoji;
          wrap.appendChild(inner);
          routeMarkers.current.push(
            new mapboxgl.Marker({ element: wrap }).setLngLat(c).addTo(map),
          );
        }
      }
      // Auf die Route einpassen (auf der Übersichtskarte aus -> focus übernimmt das)
      if (fitRouteRef.current) {
        const b = new mapboxgl.LngLatBounds();
        r.forEach((c) => b.extend(c));
        const p = paddingRef.current;
        map.fitBounds(b, {
          padding: {
            top: p?.top ?? 60,
            right: p?.right ?? 60,
            bottom: p?.bottom ?? 60,
            left: p?.left ?? 60,
          },
          maxZoom: 15,
          duration: 0,
        });
      }
    }
  };

  // Karte einmalig initialisieren
  useEffect(() => {
    if (!TOKEN || !containerRef.current || mapRef.current) return;
    mapboxgl.accessToken = TOKEN;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/outdoors-v12",
      center,
      zoom,
      cooperativeGestures: cooperative,
      // Immer flache 2D-Ansicht — keine 3D-Neigung (Pitch)
      pitch: 0,
      maxPitch: 0,
      pitchWithRotate: false,
      touchPitch: false,
    });
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");
    map.addControl(new RecenterControl(() => recenterRef.current()), "top-right");
    map.addControl(
      new mapboxgl.GeolocateControl({
        positionOptions: { enableHighAccuracy: true },
        trackUserLocation: true,
        showUserHeading: true,
      }),
      "top-right",
    );
    if (onFullscreenRef.current) {
      // Vollbild separat oben-links -> klar getrennt von den Karten-Tools rechts
      map.addControl(
        new FullscreenControl(() => onFullscreenRef.current?.()),
        "top-left",
      );
    }
    // Route-Layer anlegen, sobald der Style geladen ist
    map.on("load", () => {
      if (!map.getSource("sg-route")) {
        map.addSource("sg-route", {
          type: "geojson",
          data: routeFC(routeRef.current ?? []),
        });
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
      }
      drawRouteRef.current();
    });
    // Klick auf die leere Karte schließt die Vorschau (Marker stoppen das Event)
    map.on("click", () => onMapClickRef.current?.());
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Signatur der Marker (Slug+Koordinaten+Zustand) — Basis für den Effekt
  const markersSig = markers
    .map((m) => `${m.slug}:${m.lat},${m.lng}:${m.locked ? 1 : 0}:${m.emoji ?? ""}`)
    .join("|");

  // Marker bei Änderung neu setzen + fitBounds
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    markerObjs.current.forEach((m) => m.remove());
    markerObjs.current = [];
    markerEls.current.clear();

    const valid = markers.filter((m) => m.lat != null && m.lng != null);
    if (valid.length === 0) return;

    const bounds = new mapboxgl.LngLatBounds();
    valid.forEach((mk, i) => {
      // Wrapper (von Mapbox positioniert) + inneres, animiertes .sg-marker
      const wrap = document.createElement("button");
      wrap.type = "button";
      wrap.className = "sg-pin" + (mk.slug === selectedRef.current ? " sg-pin--active" : "");
      wrap.setAttribute("aria-label", mk.title ?? mk.slug);
      const inner = document.createElement("span");
      const label = mk.locked ? "🤫" : (mk.emoji ?? "📍");
      // Nummerierte Tour-Stopps bekommen eine eigene Typo-Klasse (iOS-fett).
      inner.className = "sg-marker" + (!mk.locked && /^\d+$/.test(label) ? " sg-marker--num" : "");
      inner.textContent = label;
      // Gestaffelter „Drop-in" (Airbnb-Stil), Verzögerung gedeckelt
      inner.style.animationDelay = `${Math.min(i, 16) * 28}ms`;
      wrap.appendChild(inner);
      wrap.addEventListener("click", (ev) => {
        ev.stopPropagation();
        onMarkerClick?.(mk.slug);
      });
      const marker = new mapboxgl.Marker({ element: wrap })
        .setLngLat([mk.lng, mk.lat])
        .addTo(map);
      markerObjs.current.push(marker);
      markerEls.current.set(mk.slug, wrap);
      bounds.extend([mk.lng, mk.lat]);
    });

    if (!bounds.isEmpty()) {
      map.fitBounds(bounds, {
        padding: {
          top: padding?.top ?? 90,
          right: padding?.right ?? 90,
          bottom: padding?.bottom ?? 90,
          left: padding?.left ?? 90,
        },
        maxZoom: 13,
        duration: 600,
      });
    }
    // Nur neu setzen/einpassen, wenn sich die Marker WIRKLICH ändern (nicht bei
    // jedem Re-Render durch neue Array-Referenz) -> Karte springt nicht mehr.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markersSig]);

  // Ausgewählten Pin hervorheben (nur Klasse umschalten, keine Neu-Erstellung)
  useEffect(() => {
    markerEls.current.forEach((el, slug) => {
      el.classList.toggle("sg-pin--active", slug === selectedSlug);
    });
  }, [selectedSlug]);

  // Sanft auf den ausgewählten Spot fliegen (Airbnb-Stil). Bei einer Wanderung
  // (focus.route) auf die ganze Route einpassen – über dem Sheet (padBottom).
  const focusRouteLen = focus?.route?.length ?? 0;
  const focusBoundsKey = focus?.bounds ? focus.bounds.join(",") : "";
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focus) return;
    const pad = { top: focus.padTop ?? 60, right: 60, left: 60, bottom: focus.padBottom ?? 0 };
    // Bevorzugt die sofort vorhandene Routen-Bounding-Box -> genau EIN Zoom auf den
    // finalen Ausschnitt (identisch zum fitBounds der Route), ohne aufs Nachladen der
    // Linie zu warten. Die Linie zeichnet sich später in den bereits richtigen
    // Ausschnitt -> kein Umspringen mehr.
    if (focus.bounds) {
      map.fitBounds(
        [
          [focus.bounds[0], focus.bounds[1]],
          [focus.bounds[2], focus.bounds[3]],
        ],
        { padding: pad, maxZoom: 15, duration: 600, essential: true },
      );
    } else if (focus.route && focus.route.length >= 2) {
      const b = new mapboxgl.LngLatBounds();
      focus.route.forEach((c) => b.extend(c));
      map.fitBounds(b, { padding: pad, maxZoom: 15, duration: 600, essential: true });
    } else {
      map.flyTo({
        center: [focus.lng, focus.lat],
        padding: pad,
        zoom: Math.max(map.getZoom(), 14),
        duration: 600,
        essential: true,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.lng, focus?.lat, focus?.padBottom, focusBoundsKey, focusRouteLen]);

  // Route neu zeichnen, wenn sie sich ändert
  useEffect(() => {
    drawRouteRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeSig]);

  // Dezenter Highlight-Punkt (Sync mit dem Höhenprofil)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (highlight) {
      if (!hlMarker.current) {
        const el = document.createElement("div");
        el.className = "sg-hl-dot";
        hlMarker.current = new mapboxgl.Marker({ element: el })
          .setLngLat(highlight)
          .addTo(map);
      } else {
        hlMarker.current.setLngLat(highlight);
      }
    } else {
      hlMarker.current?.remove();
      hlMarker.current = null;
    }
  }, [highlight?.[0], highlight?.[1]]);

  if (!TOKEN) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-cream p-6 text-center text-sm text-muted">
        Karte nicht verfügbar — <code>NEXT_PUBLIC_MAPBOX_TOKEN</code> fehlt in
        .env.local.
      </div>
    );
  }

  return <div ref={containerRef} className={`h-full w-full ${mapClass ?? ""}`} />;
}
