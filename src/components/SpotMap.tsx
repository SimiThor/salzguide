"use client";

import mapboxgl from "mapbox-gl";

import "mapbox-gl/dist/mapbox-gl.css";
import { useEffect, useRef } from "react";
import { MapLoadingScreen, useMapLoading } from "./MapLoading";
import { RecenterControl } from "./mapControls";
import { useLatestRef } from "@/lib/use-latest-ref";
import { poiEmoji, type PoiKind } from "@/lib/poi";
import { isClosedRoute } from "@/lib/geo";
import {
  routeFC,
  ROUTE_DRAW_MS,
  ROUTE_FADE_MS,
  easeOut,
  progress,
  setTrim,
  setRouteOpacity,
  addRouteSourceAndLayers,
} from "@/lib/route-anim";

export type MapMarker = {
  slug: string;
  lat: number;
  lng: number;
  emoji?: string | null;
  locked?: boolean;
  title?: string;
  // Zweite Zeile der Vorschau-Karte (z.B. der Kurztext des Spots). Nur Anzeige.
  subtitle?: string | null;
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
  // Eigenes Symbol statt des Gattungs-Emojis. Der Spot selbst (kind "spot") bringt
  // damit sein Emoji mit, statt auf 📍 zurückzufallen.
  emoji?: string | null;
};

const TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

// Wiederverwendbare, vollflächige Mapbox-Karte (docs/02 §8, docs/10).
// Emoji-Kreis-Marker (🤫 wenn locked), fitBounds, Navigation + Geolocate.
type Padding = { top?: number; right?: number; bottom?: number; left?: number };

// Die Route-Zeichnung (routeFC, Konstanten, setTrim/setRouteOpacity, Layer-Aufbau)
// liegt jetzt in src/lib/route-anim.ts, damit Live-Karte und Intro-Video-Renderer
// exakt denselben Look teilen. Hier bleibt nur, was rein zur Live-Karte gehört.

// Respektiert die System-Einstellung „Bewegung reduzieren": dann wird die Linie ohne
// Zeichen-Animation sofort gezeigt.
const reducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

export default function SpotMap({
  markers,
  onMarkerClick,
  selectedSlug,
  center = [13.05, 47.6],
  zoom = 8,
  padding,
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
  openMapLabel,
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
  // Wenn gesetzt, ist diese Karte eine VORSCHAU: keine Gesten, keine Knöpfe, die ganze
  // Fläche ruft beim Antippen diesen Callback (siehe `preview` weiter unten).
  onFullscreen?: () => void;
  // Beschriftung dieser Fläche für Screenreader ("Karte öffnen"). Kommt wie start-/
  // finishLabel vom Aufrufer per next-intl, damit SpotMap reine Darstellung bleibt.
  openMapLabel?: string;
  // Zusätzliche CSS-Klasse am Karten-Container (steuert u.a. Control-Position mobil)
  mapClass?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Ladeschirm über der Karte, bis das erste fertige Kartenbild steht (siehe unten).
  const { bindMap, loading } = useMapLoading();
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markerObjs = useRef<mapboxgl.Marker[]>([]);
  const hlMarker = useRef<mapboxgl.Marker | null>(null);
  const poiMarkers = useRef<mapboxgl.Marker[]>([]);
  // DOM-Elemente der Routen-Enden (🥾/🏁) pro Schlüssel -> Hervorhebung + Antippen.
  const routeEndEls = useRef<Map<string, HTMLElement>>(new Map());
  // Alle Props, die die langlebigen Karten-Handler brauchen, liegen in Refs -> sie lesen
  // immer den neuesten Stand statt der Props vom ersten Render. Siehe use-latest-ref.ts.
  // BEWUSST alle zusammen ganz oben: die Callback-Refs weiter unten (recenterRef,
  // syncRouteRef) greifen darauf zu und dürfen nicht auf später Deklariertes zeigen.
  const onPoiSelectRef = useLatestRef(onPoiSelect);
  const startLabelRef = useLatestRef(startLabel);
  const finishLabelRef = useLatestRef(finishLabel);
  const routeRef = useLatestRef(route);
  const showRouteEndsRef = useLatestRef(showRouteEnds);
  const fitRouteRef = useLatestRef(fitRoute);
  // Einen Punkt zentrieren (sanft), wenn er angetippt wird.
  const selectPoi = (p: SpotPoi) => {
    onPoiSelectRef.current?.(p);
    mapRef.current?.easeTo({ center: [p.lng, p.lat], duration: 420, essential: true });
  };

  // Aktuelle Marker/Padding für den Zentrieren-Button (liest immer den neuesten Stand)
  const markersRef = useLatestRef(markers);
  // Marker-DOM-Elemente pro Slug + ausgewählter Spot (für die Hervorhebung)
  const markerEls = useRef<Map<string, HTMLElement>>(new Map());
  const selectedRef = useLatestRef(selectedSlug);
  const paddingRef = useLatestRef(padding);
  const onMapClickRef = useLatestRef(onMapClick);
  const recenterRef = useLatestRef(() => {
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
  });

  // Route (Wanderweg) zeichnen
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
  const syncRouteRef = useLatestRef(() => {
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
      // Bei geschlossenen Routen (Rundweg / hin+retour) liegen Start und Ziel auf derselben
      // Stelle -> nur EIN Pin (🥾 Start), kein doppelter 🏁-Ziel-Pin. Sonst Ziel zuerst
      // (darunter), Start zuletzt + höherer z-index, damit Start über dem Ziel liegt. Das Ziel
      // wartet, bis die Linie dort angekommen ist (sg-pin-in füllt „backwards").
      const closed = isClosedRoute(r);
      const ends: [[number, number], "start" | "finish", string, number, number][] = closed
        ? [[r[0], "start", "🥾", 4, 0]]
        : [
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
  });

  // ZWEI ARTEN VON KARTE, EINE UNTERSCHEIDUNG.
  //
  // `onFullscreen` ist genau dann gesetzt, wenn diese Karte eine grosse Fassung hat —
  // also auf den EINGEBETTETEN Karten (Spot-Seite, Gespeichert). Das ist keine Karte,
  // auf der man arbeitet, sondern eine Vorschau: Sie beantwortet „wo ungefähr ist das",
  // und wer mehr will, macht sie gross.
  //
  // Eine Vorschau ist deshalb ein BILD MIT EINEM TAP, nicht eine kleine Karte:
  //   - Sie lässt sich nicht verschieben und nicht zoomen. Damit kann sie nie verrutscht
  //     zurückbleiben und sieht bei jedem Besuch aus wie gedacht.
  //   - Sie trägt keinen einzigen Knopf. Zoom konnten die Finger ohnehin, „Standort"
  //     zeigt bei einem Spot 40km entfernt entweder nichts oder springt vom Thema weg,
  //     und „Zentrieren" nützt erst, wenn man verschoben hat.
  //   - Die ganze Fläche ist die Schaltfläche. Grösser als „alles" wird ein Tap-Ziel
  //     nicht, und es gibt nur noch eine Sache, die man tun kann.
  //
  // Alles, was man vorher hier tun konnte, tut man eine Ebene weiter im Vollbild — dort
  // ist Platz dafür. Arbeits-Karten (Explore, Wasser, Touren, alle Vollbild-Fassungen)
  // bleiben unverändert.
  const preview = Boolean(onFullscreen);

  // Karte einmalig initialisieren
  useEffect(() => {
    if (!TOKEN || !containerRef.current || mapRef.current) return;
    mapboxgl.accessToken = TOKEN;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/outdoors-v12",
      center,
      zoom,
      // Vorschau-Karten reagieren auf GAR keine Geste (siehe Kommentar unten): kein
      // Ziehen, kein Zoomen, kein Drehen. Deshalb braucht es hier auch keine
      // Zwei-Finger-Sperre mehr — der Hinweis „Use two fingers to move the map" war
      // einer der deutlichsten Verräter „Webseite", und ohne Gesten will ihn niemand.
      interactive: !preview,
      // Attribution IMMER kompakt, auf jeder Karte.
      //
      // Mapbox entscheidet das sonst selbst — nach der BREITE der jeweiligen Karte
      // (bis 640px das „i", darüber der ausgeschriebene Text). Unsere Karten sind
      // verschieden breit, also stand bei 1024px Fensterbreite gemessen: Explore 544px
      // -> „i", Spot-Seite 728px -> Text, Gespeichert 992px -> Text. Drei Karten, drei
      // Antworten, auf demselben Bildschirm.
      //
      // Erlaubt ist beides: Mapbox verlangt das LOGO dauerhaft sichtbar („we require
      // the Mapbox logo to appear on our maps"), die Text-Attribution darf hinter einer
      // Schaltfläche liegen — ihre eigenen mobilen SDKs liefern genau so einen
      // Info-Knopf mit. Das Logo bleibt unangetastet, nur der Text wandert einen Tap
      // weiter. Kompakt passt ausserdem zu Karten, die bei uns oft klein sind.
      attributionControl: false,
      // Immer flache 2D-Ansicht — keine 3D-Neigung (Pitch)
      pitch: 0,
      maxPitch: 0,
      pitchWithRotate: false,
      touchPitch: false,
    });
    map.addControl(new mapboxgl.AttributionControl({ compact: true }));

    // Bedienung gibt es nur auf Arbeits-Karten. Vorschauen tragen keinen einzigen
    // Knopf — dort ist die ganze Fläche der Knopf (siehe `preview` weiter oben).
    if (!preview) {
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
    }
    // Route-Layer anlegen, sobald der Style geladen ist (gemeinsamer Aufbau, siehe route-anim.ts)
    map.on("load", () => {
      addRouteSourceAndLayers(map, routeRef.current ?? []);
      syncRouteRef.current();
    });
    // Ladeschirm an die Karte hängen: Er zeigt den Fortschritt und geht weg, sobald
    // das erste fertige Kartenbild steht (Meilensteine + Sicherheitsnetz in MapLoading).
    const unbindLoading = bindMap(map);
    // Klick auf die leere Karte schließt die Vorschau (Marker stoppen das Event)
    map.on("click", () => onMapClickRef.current?.());
    mapRef.current = map;
    return () => {
      unbindLoading();
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

  // Dezenter Highlight-Punkt (Sync mit dem Höhenprofil).
  // Auf die beiden Zahlen heruntergebrochen: `highlight` ist bei jedem Render ein neues
  // Array und würde den Effekt sonst dauernd neu auslösen, obwohl der Punkt gleich blieb.
  const hlLng = highlight?.[0];
  const hlLat = highlight?.[1];
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (hlLng != null && hlLat != null) {
      if (!hlMarker.current) {
        const el = document.createElement("div");
        el.className = "sg-hl-dot";
        hlMarker.current = new mapboxgl.Marker({ element: el })
          .setLngLat([hlLng, hlLat])
          .addTo(map);
      } else {
        hlMarker.current.setLngLat([hlLng, hlLat]);
      }
    } else {
      hlMarker.current?.remove();
      hlMarker.current = null;
    }
  }, [hlLng, hlLat]);

  // Zusatzpunkte (Wasserstellen, Hütten, Parkplatz) als Emoji-Pins wie 🥾/🏁.
  // Antippen zentriert den Punkt und meldet ihn nach oben (onPoiSelect) -> das
  // Kärtchen erscheint unten. Kein Mapbox-Popup mehr.
  const poiSig = (poi ?? [])
    .map(
      (p) =>
        `${p.kind}:${p.subtype ?? ""}:${p.lng},${p.lat}:${p.name ?? ""}:${p.label ?? ""}:${p.emoji ?? ""}`,
    )
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
      const emoji = p.emoji ?? poiEmoji(p.kind, p.subtype);
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

  // Der Ladeschirm liegt deckend VOR der Karte und blendet weg — die Karte selbst
  // braucht deshalb keine eigene Blende mehr (zwei überlagerte Blenden ergäben in der
  // Mitte einen sichtbaren Helligkeits-Einbruch).
  //
  // Die Klasse am Container darf sich NIE ändern: Mapbox hängt `mapboxgl-map` per
  // classList.add daran; React fasst className zwar nur an, wenn sich der String
  // ändert, schreibt dann aber das ganze Attribut neu und wirft Mapbox' Klasse raus.
  // Die Karte verlöre ihr eigenes CSS. Alles Wechselnde gehört darum nach außen.
  return (
    <div className="relative isolate h-full w-full">
      <div ref={containerRef} className={`h-full w-full ${mapClass ?? ""}`} />

      {/* Die Vorschau als EIN Bedienelement. Ein echter <button>, kein div mit onClick:
          So kommt man auch mit Tastatur und Screenreader hin, und die Beschriftung sagt,
          was passiert. Er liegt nach der Karte im DOM und damit über den Markern — die
          sollen hier bewusst nicht einzeln antippbar sein, dafür ist das Vollbild da. */}
      {preview && (
        <button
          type="button"
          onClick={onFullscreen}
          aria-label={openMapLabel}
          // Ebene 9, mit Absicht knapp UNTER 10. Die Ebenen-Leiter der Karten steht in
          // globals.css: Marker (bis 6) < Standort (8) < Bedienung und Attribution (10)
          // < Schutzfläche (20). Auf 10 lag die Fläche gleichauf mit der Attribution und
          // gewann als spätere Zeile — das Mapbox-Logo und der „i"-Knopf waren nicht mehr
          // antippbar. Das ist nicht nur unschön, sondern verstösst gegen Mapbox' Regeln
          // zur Namensnennung. Auf 9 deckt sie alles ab, worauf hier niemand tippen soll
          // (Karte, Pins), und lässt genau das durch, was durchmuss.
          className="sg-native-tap absolute inset-0 z-[9] cursor-pointer"
        >
          {/* Der Hinweis, dass hier etwas passiert. Rein dekorativ (der Knopf ist die
              ganze Fläche), deshalb pointer-events-none und aria-hidden. Ohne ihn sieht
              die Karte aus wie ein Bild, und niemand käme auf die Idee zu tippen. */}
          <span
            aria-hidden
            className="pointer-events-none absolute left-3 top-3 flex h-9 w-9 items-center justify-center rounded-[11px] border border-black/5 bg-white/80 text-ink shadow-[0_3px_14px_-4px_rgba(0,0,0,0.22)] backdrop-blur-md"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="15 3 21 3 21 9" />
              <polyline points="9 21 3 21 3 15" />
              <line x1="21" y1="3" x2="14" y2="10" />
              <line x1="3" y1="21" x2="10" y2="14" />
            </svg>
          </span>
        </button>
      )}

      <MapLoadingScreen {...loading} />
    </div>
  );
}
