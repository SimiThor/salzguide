"use client";

import mapboxgl from "mapbox-gl";

import "mapbox-gl/dist/mapbox-gl.css";
import { useEffect, useRef, useState } from "react";
import { RecenterControl, FullscreenControl } from "./mapControls";
import { poiEmoji, type PoiKind } from "@/lib/poi";

export type MapMarker = {
  slug: string;
  lat: number;
  lng: number;
  emoji?: string | null;
  locked?: boolean;
  title?: string;
  imageUrl?: string | null; // nur für die Vorschau-Karte (MapCard), Pin nutzt Emoji
};

// Zusatzpunkt auf der Karte (Wasserstelle / Hütte / Parkplatz): Koordinaten, Art,
// optionaler Untertyp-Code, optionaler (einsprachiger) Name und das bereits in der
// Sprache des Nutzers berechnete Gattungs-Label (z.B. "Trinkbrunnen"). Das Label wird
// vom Aufrufer (Spot-Seite, per next-intl) angehängt, damit SpotMap reine Darstellung
// bleibt.
export type SpotPoi = {
  lng: number;
  lat: number;
  kind: PoiKind;
  subtype?: string;
  name?: string;
  label?: string;
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

// ——— Route-Animation ———————————————————————————————————————————————
// Die Linie erscheint nicht, sie zeichnet sich: vom Start zum Ziel, einmal, ohne
// Schnörkel. Das ist auch die Antwort auf die Ladezeit — die Route kommt per
// Server-Action nach, und ein Strich, der sich zieht, liest sich als Ankunft und
// nicht als Ruckler.
//
// Technik: line-trim-offset. Die Eigenschaft macht einen Abschnitt der Linie
// unsichtbar; wir verstecken alles hinter dem Kopf und schieben den Kopf von 0 nach 1.
// Das sind pro Frame ZWEI ZAHLEN an die GPU, sonst nichts. Die naheliegende Variante
// (line-gradient mit line-progress) kostet pro Frame einen frischen Ausdruck, den
// Mapbox parst, prüft und als Farbtextur hochlädt — gemessen 228ms Skriptzeit für
// EINE Linie, gegenüber 20ms hier. Bedingung für beides: lineMetrics an der Quelle.
//
// 600ms ist kein Geschmack, sondern genau die Dauer des Kamerafluges (focus/fitBounds
// unten). Solange die Kamera fliegt, malt Mapbox die Karte ohnehin jeden Frame neu —
// das Zeichnen reitet also auf Bildern mit, die es sowieso gibt, und kostet fast
// nichts extra. Karte und Linie kommen dadurch im selben Moment zur Ruhe, statt
// nacheinander. Länger heißt: eigene Frames, eigene Kosten, und die Linie zappelt
// noch, wenn die Karte längst steht.
const ROUTE_DRAW_MS = 600;
// Ausblenden ist bewusst deutlich kürzer als die 0.5s des Sheets: Route und Auswahl
// sollen das Schließen ANFÜHREN, nicht hinterherhinken.
const ROUTE_FADE_MS = 260;
// Weicher Kopf (Anteil der Streckenlänge): line-trim-fade-range lässt die Spitze
// auslaufen, statt sie wie abgeschnitten aussehen zu lassen. Wird einmalig gesetzt
// und kostet im Betrieb nichts.
const ROUTE_HEAD = 0.05;

const ROUTE_LINE = "#e04848";
const ROUTE_OUT = "#ffffff";

// Mapbox legt auf line-opacity von sich aus einen 300ms-Übergang. Jeder Frame unserer
// Blende startete damit einen NEUEN 300ms-Übergang — die Linie blieb fast deckend
// stehen und wurde am Ende hart abgeschnitten, also genau das, was wir wegmachen
// wollen. Wir steuern die Deckkraft selbst, deshalb muss Mapbox hier die Finger
// stillhalten. (line-gradient ist laut Style-Spec nicht übergangsfähig, das Zeichnen
// war deshalb nie betroffen.)
const NO_TRANSITION = { duration: 0, delay: 0 };

// Abbremsend (iOS-Gefühl): schnell los, sanft ankommen. Bewusst NICHT die
// Sheet-Kurve — die Linie ist kein Sheet und muss nicht mit ihm synchron laufen.
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

// Fortschritt 0..1. Der Zeitstempel von requestAnimationFrame ist der Beginn des
// Frames und liegt dadurch ein paar Millisekunden VOR dem performance.now(), mit dem
// wir starten — ohne die untere Klemme wird der erste Schritt negativ und Mapbox
// weist die Deckkraft als „greater than the maximum value 1" zurück.
const progress = (now: number, t0: number, ms: number) =>
  Math.min(Math.max((now - t0) / ms, 0), 1);

const reducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

// Linie bis `p` (0..1) zeigen. line-trim-offset [a,b] blendet den Abschnitt ZWISCHEN
// a und b aus, wir verstecken also alles hinter dem Kopf. p=0 -> [0,1] = ganz weg,
// p=1 -> [1,1] = nichts versteckt.
function setTrim(map: mapboxgl.Map, p: number) {
  const head = Math.min(Math.max(p, 0), 1);
  const trim: [number, number] = [head, 1];
  map.setPaintProperty("sg-route-out", "line-trim-offset", trim);
  map.setPaintProperty("sg-route-line", "line-trim-offset", trim);
}

function setRouteOpacity(map: mapboxgl.Map, o: number) {
  map.setPaintProperty("sg-route-out", "line-opacity", o);
  map.setPaintProperty("sg-route-line", "line-opacity", o);
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
  poi,
  onPoiSelect,
  selectedPoiKey,
  startLabel,
  finishLabel,
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
  // Zusatzpunkte (Wasserstellen, Hütten, Parkplatz) als Pins. Ohne onPoiSelect nur Anzeige.
  poi?: SpotPoi[];
  // Antippen eines Punkts (POI ODER Routen-Start/-Ziel): der Punkt zentriert sich und
  // der Aufrufer zeigt unten das iOS-Kärtchen. null = geschlossen. Bekommt onPoiSelect
  // KEINEN Wert, bleibt alles wie gehabt (kein Kärtchen).
  onPoiSelect?: (poi: SpotPoi | null) => void;
  // Schlüssel des gewählten Punkts ("kind:lng,lat") -> hebt den Pin hervor.
  selectedPoiKey?: string | null;
  // Lokalisierte Beschriftungen der Routen-Enden (nur wenn onPoiSelect gesetzt ist).
  startLabel?: string;
  finishLabel?: string;
  // Wenn gesetzt: Vollbild-Button anzeigen, Klick ruft den Callback
  onFullscreen?: () => void;
  // Zusätzliche CSS-Klasse am Karten-Container (steuert u.a. Control-Position mobil)
  mapClass?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Steht das erste fertige Kartenbild? Steuert nur das Einblenden (siehe unten).
  const [mapReady, setMapReady] = useState(false);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markerObjs = useRef<mapboxgl.Marker[]>([]);
  const hlMarker = useRef<mapboxgl.Marker | null>(null);
  const poiMarkers = useRef<mapboxgl.Marker[]>([]);
  // DOM-Elemente der Routen-Enden (🥾/🏁) pro Schlüssel -> Hervorhebung + Antippen.
  const routeEndEls = useRef<Map<string, HTMLElement>>(new Map());
  const onFullscreenRef = useRef(onFullscreen);
  onFullscreenRef.current = onFullscreen;
  // Callbacks/Labels für die antippbaren Punkte (Handler lesen immer den neuesten Stand).
  const onPoiSelectRef = useRef(onPoiSelect);
  onPoiSelectRef.current = onPoiSelect;
  const startLabelRef = useRef(startLabel);
  startLabelRef.current = startLabel;
  const finishLabelRef = useRef(finishLabel);
  finishLabelRef.current = finishLabel;
  // Einen Punkt zentrieren (sanft), wenn er angetippt wird.
  const selectPoi = (p: SpotPoi) => {
    onPoiSelectRef.current?.(p);
    mapRef.current?.easeTo({ center: [p.lng, p.lat], duration: 420, essential: true });
  };

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
  // Was gerade auf der Karte liegt ("" = nichts). Trennt „hat sich wirklich geändert"
  // von „React hat neu gerendert" — sonst startete die Zeichen-Animation von vorn.
  const shownSig = useRef("");
  const rafRef = useRef<number | null>(null);
  const stopRouteAnim = () => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  };
  const syncRouteRef = useRef<() => void>(() => {});
  syncRouteRef.current = () => {
    const map = mapRef.current;
    if (!map) return;
    const src = map.getSource("sg-route") as mapboxgl.GeoJSONSource | undefined;
    if (!src) return;
    const r = routeRef.current ?? [];
    const next = r.length >= 2 ? routeSig : "";
    if (next === shownSig.current) return;
    stopRouteAnim();
    shownSig.current = next;

    // Keine Route mehr -> ausblenden, DANN leeren. Vorher verschwand die Linie in
    // dem Moment hart, in dem das Sheet schon unten war.
    if (!next) {
      const clear = () => {
        src.setData(routeFC([]));
        routeMarkers.current.forEach((m) => m.remove());
        routeMarkers.current = [];
        setRouteOpacity(map, 1); // für das nächste Zeichnen zurückstellen
      };
      if (reducedMotion()) {
        clear();
        return;
      }
      const t0 = performance.now();
      const step = (now: number) => {
        const t = progress(now, t0, ROUTE_FADE_MS);
        setRouteOpacity(map, 1 - t); // linear: bei reiner Deckkraft am ruhigsten
        if (t < 1) {
          rafRef.current = requestAnimationFrame(step);
          return;
        }
        rafRef.current = null;
        clear();
      };
      rafRef.current = requestAnimationFrame(step);
      return;
    }

    // Neue Route -> zeichnen. Kopf VOR setData setzen, sonst blitzt die fertige
    // Linie ein Bild lang auf.
    const animated = !reducedMotion();
    setRouteOpacity(map, 1);
    setTrim(map, animated ? 0 : 1);
    src.setData(routeFC(r));
    routeMarkers.current.forEach((m) => m.remove());
    routeMarkers.current = [];
    routeEndEls.current.clear();
    // Start/Ziel-Marker (auf der Übersichtskarte aus -> nur die Linie)
    if (showRouteEndsRef.current) {
      // Ziel zuerst (darunter), Start zuletzt + höherer z-index -> Start liegt
      // immer ÜBER dem Ziel (wichtig bei Rundwegen, wo Start ≈ Ziel).
      // Das Ziel wartet, bis die Linie dort angekommen ist (sg-pin-in füllt
      // „backwards", hält es also bis dahin unsichtbar).
      const ends: [[number, number], "start" | "finish", string, number, number][] = [
        [r[r.length - 1], "finish", "🏁", 2, animated ? ROUTE_DRAW_MS : 0],
        [r[0], "start", "🥾", 4, 0],
      ];
      for (const [c, kind, emoji, z, delay] of ends) {
        // Antippbar, wenn der Aufrufer onPoiSelect setzt (Detailkarte). Sonst reiner
        // Anzeige-Marker wie bisher (Tour-Übersicht etc.).
        const clickable = !!onPoiSelectRef.current;
        const wrap = document.createElement(clickable ? "button" : "div");
        if (clickable) (wrap as HTMLButtonElement).type = "button";
        wrap.className = "sg-pin";
        wrap.style.zIndex = String(z);
        wrap.dataset.baseZ = String(z);
        const inner = document.createElement("span");
        inner.className = "sg-marker";
        inner.textContent = emoji;
        inner.style.animationDelay = `${delay}ms`;
        wrap.appendChild(inner);
        if (clickable) {
          const label = kind === "start" ? startLabelRef.current : finishLabelRef.current;
          wrap.setAttribute("aria-label", label ?? emoji);
          wrap.addEventListener("click", (ev) => {
            ev.stopPropagation();
            selectPoi({ lng: c[0], lat: c[1], kind, label });
          });
          routeEndEls.current.set(`${kind}:${c[0]},${c[1]}`, wrap);
        }
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
    if (!animated) return;
    const t0 = performance.now();
    const step = (now: number) => {
      const t = progress(now, t0, ROUTE_DRAW_MS);
      setTrim(map, easeOut(t));
      rafRef.current = t < 1 ? requestAnimationFrame(step) : null;
    };
    rafRef.current = requestAnimationFrame(step);
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
          // Pflicht für line-progress -> ohne das kann sich die Linie nicht zeichnen.
          lineMetrics: true,
        });
        map.addLayer({
          id: "sg-route-out",
          type: "line",
          source: "sg-route",
          paint: {
            "line-color": ROUTE_OUT,
            "line-width": 6.5,
            "line-opacity-transition": NO_TRANSITION,
            "line-trim-fade-range": [ROUTE_HEAD, 0],
          },
          layout: { "line-join": "round", "line-cap": "round" },
        });
        map.addLayer({
          id: "sg-route-line",
          type: "line",
          source: "sg-route",
          paint: {
            "line-color": ROUTE_LINE,
            "line-width": 3.5,
            "line-opacity-transition": NO_TRANSITION,
            "line-trim-fade-range": [ROUTE_HEAD, 0],
          },
          layout: { "line-join": "round", "line-cap": "round" },
        });
      }
      syncRouteRef.current();
    });
    // Erst zeigen, wenn wirklich etwas zu sehen ist. Die Karte braucht JS und Kacheln,
    // erschien also als harter Schnitt in eine Fläche, die vorher leer war. `idle`
    // statt `load`: load feuert, sobald der Style steht, die erste Kachel aber noch
    // fehlen kann -> man blendet Grau ein. idle heißt, das erste Bild ist fertig.
    map.once("idle", () => setMapReady(true));
    // Sicherheitsnetz: Bliebe `idle` je aus (tote Kacheln, kein Netz, WebGL-Zicken),
    // wäre die Karte für immer unsichtbar. Lieber hart einblenden als gar nicht.
    const showAnyway = setTimeout(() => setMapReady(true), 3000);
    // Klick auf die leere Karte schließt die Vorschau (Marker stoppen das Event)
    map.on("click", () => onMapClickRef.current?.());
    mapRef.current = map;
    return () => {
      clearTimeout(showAnyway);
      stopRouteAnim();
      poiMarkers.current.forEach((m) => m.remove());
      poiMarkers.current = [];
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
    syncRouteRef.current();
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

  // Zusatzpunkte (Wasserstellen, Hütten, Parkplatz) als Emoji-Pins wie 🥾/🏁.
  // Antippen zentriert den Punkt und meldet ihn nach oben (onPoiSelect) -> das
  // Kärtchen erscheint unten. Kein Mapbox-Popup mehr.
  const poiSig = (poi ?? [])
    .map((p) => `${p.kind}:${p.subtype ?? ""}:${p.lng},${p.lat}:${p.name ?? ""}:${p.label ?? ""}`)
    .join("|");
  // DOM-Elemente der POI-Pins pro Schlüssel -> Hervorhebung des gewählten Punkts.
  const poiEls = useRef<Map<string, HTMLElement>>(new Map());
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    poiMarkers.current.forEach((m) => m.remove());
    poiMarkers.current = [];
    poiEls.current.clear();
    for (const p of poi ?? []) {
      const emoji = poiEmoji(p.kind, p.subtype);
      const key = `${p.kind}:${p.lng},${p.lat}`;
      const wrap = document.createElement("button");
      wrap.type = "button";
      wrap.className = "sg-pin sg-pin--poi";
      // Ruhe-Ebene über den Routen-Enden. baseZ = wohin der Pin zurückfällt, wenn er
      // nicht mehr gewählt ist (der Hervorhebungs-Effekt hebt den gewählten kurz an).
      wrap.style.zIndex = "5";
      wrap.dataset.baseZ = "5";
      wrap.setAttribute("aria-label", p.name ? `${p.name} (${p.label ?? ""})`.trim() : p.label ?? emoji);
      const inner = document.createElement("span");
      inner.className = "sg-marker";
      inner.textContent = emoji;
      wrap.appendChild(inner);
      const marker = new mapboxgl.Marker({ element: wrap }).setLngLat([p.lng, p.lat]).addTo(map);
      wrap.addEventListener("click", (ev) => {
        // Nicht bis zur Karte durchreichen (sonst schlösse ein Klick z.B. Sheets).
        ev.stopPropagation();
        if (!onPoiSelectRef.current) return;
        selectPoi(p);
      });
      poiEls.current.set(key, wrap);
      poiMarkers.current.push(marker);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poiSig]);

  // Gewählten Punkt hervorheben (Pin wächst leicht) UND nach vorn holen, damit er nicht
  // hinter einem Nachbar-Pin liegt. z=6 ist über allen Pins (max Basis 5), aber weiter im
  // Marker-Layer der Karte -> die Karten-UI (Kärtchen, Controls) liegt ohnehin darüber.
  // Abgewählt fällt der Pin auf seine Basis-Ebene zurück (dataset.baseZ).
  useEffect(() => {
    const apply = (el: HTMLElement, key: string) => {
      const active = key === selectedPoiKey;
      el.classList.toggle("sg-pin--active", active);
      el.style.zIndex = active ? "6" : (el.dataset.baseZ ?? "");
    };
    poiEls.current.forEach(apply);
    routeEndEls.current.forEach(apply);
  }, [selectedPoiKey, poiSig]);

  if (!TOKEN) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-cream p-6 text-center text-sm text-muted">
        Karte nicht verfügbar — <code>NEXT_PUBLIC_MAPBOX_TOKEN</code> fehlt in
        .env.local.
      </div>
    );
  }

  // Weich aufblenden statt aufpoppen. Reine CSS-Deckkraft: läuft im Compositor, kostet
  // keinen Frame Rechenzeit und keine Mapbox-Neuzeichnung.
  //
  // Die Blende MUSS auf einem eigenen Wrapper sitzen. Mapbox hängt seine Klasse
  // `mapboxgl-map` per classList.add an den Container; React fasst className nur an,
  // wenn sich der String ändert — genau das tut ein wechselndes opacity-0/100 aber, und
  // React schreibt dann das ganze Attribut neu und wirft Mapbox' Klasse raus. Die Karte
  // verlor damit ihr eigenes CSS. Der Container unten bleibt deshalb unveränderlich.
  return (
    <div
      className={`h-full w-full motion-safe:transition-opacity motion-safe:duration-600 motion-safe:ease-out ${
        mapReady ? "opacity-100" : "opacity-0"
      }`}
    >
      <div ref={containerRef} className={`h-full w-full ${mapClass ?? ""}`} />
    </div>
  );
}
