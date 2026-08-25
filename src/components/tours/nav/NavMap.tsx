"use client";

import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { useEffect, useRef, useState } from "react";
import { MapLoadingScreen, useMapLoading } from "@/components/MapLoading";
import { MapUnavailableScreen, tryCreateMap } from "@/components/MapUnavailable";
import { useLatestRef } from "@/lib/use-latest-ref";
import { unwrapDegrees } from "@/lib/geo";
import { declutterBasemap } from "@/lib/map-declutter";
import {
  addRouteSourceAndLayers,
  addRoundShapeLayer,
  setRoundShape,
  setNavTrim,
  applyNavRouteStyle,
  routeFC,
  ROUTE_SOURCE,
  reducedMotion,
} from "@/lib/route-anim";

const TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
const NAV_PITCH = 58;
const NAV_ZOOM = 17;
// Wo im Bild der Positions-Punkt sitzen soll, als Anteil der Kartenhöhe von oben. NICHT
// die Mitte: Beim Fahren zählt allein, was VOR einem liegt, und ein zentrierter Punkt
// verschenkt die halbe Fläche an die Strecke, die man schon hinter sich hat. Google Maps
// und Apple Karten setzen ihn ebenfalls ins untere Drittel.
//
// Ohne diese Rechnung war es sogar verkehrt herum: Der untere Innenabstand für die
// HUD-Leiste schob das Kartenzentrum nach OBEN, gemessen auf Position 327 von 844.
const PUCK_AT = 0.68;

// Mapbox zentriert in dem Rechteck, das der Innenabstand übrig lässt, also auf
// (top + (H - bottom)) / 2. Nach `top` aufgelöst, damit der Punkt genau auf PUCK_AT
// landet. Gedeckelt, damit ein sehr flaches Fenster (Querformat) nicht in absurde Werte
// läuft und die Kamera unbrauchbar macht.
function topPaddingFor(heightPx: number, bottomPx: number): number {
  if (!heightPx) return 0;
  const wanted = 2 * PUCK_AT * heightPx - heightPx + bottomPx;
  return Math.max(0, Math.min(wanted, heightPx * 0.62));
}
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
  shape,
  progress,
  fix,
  bearingDeg,
  stops,
  activeIndex,
  onStopTap,
  paddingBottom = 0,
  recenterLabel,
}: {
  /**
   * Die AKTUELLE ETAPPE, von einem Halt zum naechsten. NICHT die ganze Runde.
   *
   * Bis 25.08.2026 stand hier die volle Geometrie. Auf Runde A sind 25 Prozent der Strecke
   * doppelt befahren, und die Linie lag dort auf sich selbst: Man sah zwei rote Straenge
   * und konnte nicht ablesen, in welche Richtung es weitergeht. Rot ist jetzt eine Zusage
   * fuer JETZT, und die kann es nur einmal geben.
   */
  route: [number, number][] | null;
  /**
   * WAS NOCH KOMMT, als blasse Haarlinie: ab dem naechsten Halt bis zum Rundenende.
   *
   * Nicht die ganze Runde, denn was hinter dem Gast liegt, hat er hinter sich. Googles
   * Uebersicht zeigt bei Mehrziel-Fahrten ausdruecklich nur den noch nicht gefahrenen Teil.
   * Und nicht ab der aktuellen Position, sondern ab dem naechsten Halt: So ueberlagern sich
   * blasse und rote Linie nie, und sie muss nur siebenmal je Runde neu gesetzt werden.
   */
  shape: [number, number][] | null;
  /** Fortschritt INNERHALB der aktuellen Etappe (0..1). Der gefahrene Teil verschwindet. */
  progress: number;
  fix: { lng: number; lat: number } | null;
  bearingDeg: number;
  // ALLE Stationen der Runde, nicht nur die aktuell angesteuerte – "ein Zielpunkt für
  // jede Navigation": man soll die ganze Kette der Ziele sehen, nicht erst eins, sobald
  // man in seiner Nähe ist. Der Punkt bei `activeIndex` bekommt die Ziel-Flagge, alle
  // anderen ihre Nummer (gleiche Optik wie die nummerierten Pins auf TourView).
  stops: NavStopPoint[];
  activeIndex: number;
  /**
   * Tipp auf einen Stopp-Pin. Damit kommt der Gast an JEDE Geschichte, auch wenn er nicht
   * genau am Ort steht oder die Ortung danebenliegt.
   *
   * Das automatische Angebot bleibt, es ist nur nicht mehr der einzige Weg. Genau so machen
   * es Apple Maps und Google Maps: Jeder Pin ist immer antippbar, und was dabei aufgeht, ist
   * dasselbe Kaertchen wie sonst.
   */
  onStopTap?: (index: number) => void;
  // Platz unten (px), den z.B. das Ankunfts-Sheet oder die HUD-Leisten brauchen —
  // fliesst als Kamera-Padding ein, damit der Punkt nicht darunter verschwindet.
  paddingBottom?: number;
  recenterLabel: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const puckRef = useRef<mapboxgl.Marker | null>(null);
  const coneRef = useRef<mapboxgl.Marker | null>(null);
  const stopMarkersRef = useRef<Map<number, mapboxgl.Marker>>(new Map());
  // Der Marker wird EINMAL erzeugt und danach nur noch verschoben. Haenge man den
  // Klick-Handler direkt an, zeigte er fuer immer auf die Funktion vom ersten Render.
  // Deshalb ueber ein Ref, das jeder Render frisch setzt.
  const onStopTapRef = useLatestRef(onStopTap);
  // Die Haarlinie wird beim "load" gebraucht, also muss das Ref vorher stehen.
  const shapeRef = useLatestRef(shape);
  const { bindMap, loading } = useMapLoading();
  const [mapDead, setMapDead] = useState(false);
  const [following, setFollowing] = useState(true);
  const paddingBottomRef = useLatestRef(paddingBottom);
  const routeRef = useLatestRef(route);
  const progressRef = useLatestRef(progress);

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
      // Zuerst die Haarlinie, dann die Route: Was zuerst hinzugefuegt wird, liegt unten.
      addRoundShapeLayer(map, shapeRef.current ?? []);
      addRouteSourceAndLayers(map, []);
      applyNavRouteStyle(map);
      // Kein Zeichnen-Draw-in wie auf den Übersichtskarten: Im HUD steht die Linie
      // sofort, ihre Animation würde vom eigentlichen Signal (wohin geht's) ablenken.
      setNavTrim(map, 0);
      // Die Route kann VOR dem Style da sein: der Effekt unten bricht dann ab, weil es
      // die Quelle noch nicht gibt, und ohne dieses Nachziehen bliebe die Linie leer, bis
      // sich die Route das nächste Mal ändert. Beim Start liegen dazwischen der
      // Erlaubnis-Dialog und der erste GPS-Fix, es fällt also selten auf – aber bei
      // langsamem Netz und schon erteilter Erlaubnis eben doch.
      const pending = routeRef.current;
      if (pending && pending.length > 1) {
        (map.getSource(ROUTE_SOURCE) as mapboxgl.GeoJSONSource | undefined)?.setData(
          routeFC(pending),
        );
        setNavTrim(map, progressRef.current);
      }
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
      coneRef.current?.remove();
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
        wrap.className = "sg-pin sg-hit";
        wrap.style.cursor = "pointer";
        wrap.setAttribute("role", "button");
        wrap.setAttribute("tabindex", "0");
        const inner = document.createElement("span");
        inner.className = "sg-marker";
        wrap.appendChild(inner);
        const tippen = (e: Event) => {
          // Sonst faehrt die Karte darunter mit: Mapbox behandelt den Tipp als Karten-Klick
          // und der Gast verliert die Kameraverfolgung, waehrend er faehrt.
          e.stopPropagation();
          e.preventDefault();
          onStopTapRef.current?.(i);
        };
        wrap.addEventListener("click", tippen);
        wrap.addEventListener("keydown", (e) => {
          if ((e as KeyboardEvent).key === "Enter" || (e as KeyboardEvent).key === " ") tippen(e);
        });
        marker = new mapboxgl.Marker({ element: wrap }).setLngLat([s.lng, s.lat]).addTo(map);
        stopMarkersRef.current.set(i, marker);
      } else {
        marker.setLngLat([s.lng, s.lat]);
      }
      const el = marker.getElement();
      el.classList.toggle("sg-pin--active", active);
      // NUR DER NAECHSTE HALT traegt einen nummerierten Pin. Alle anderen sind ruhige
      // Punkte ohne Nummer und ohne Kachel, weiterhin antippbar.
      //
      // Vorher trugen alle sieben eine Nummer in einer weissen Kachel. Auf einer Runde, die
      // sich selbst kreuzt, standen davon mehrere dicht beieinander und konkurrierten mit
      // der Fuehrung. Googles Fahransicht zeigt aus demselben Grund nur den Zielmarker.
      el.classList.toggle("sg-pin--quiet", !active && i !== stops.length - 1);
      const inner = el.querySelector(".sg-marker") as HTMLElement | null;
      if (inner) {
        // Die Zielflagge gehört dem LETZTEN Stopp, nicht dem gerade angesteuerten. Vorher
        // trug sie der aktive: Stand sie beim ersten Spot, las sich das wie "hier endet
        // die Runde", also genau falsch herum. Der angesteuerte Stopp wird stattdessen
        // hervorgehoben (sg-pin--active) und behält seine Nummer, damit man weiterhin
        // sieht, der wievielte er ist.
        // Die Zielflagge gehoert dem LETZTEN Stopp und erscheint erst, wenn er dran ist.
        const isLast = i === stops.length - 1;
        const zeigen = active || isLast;
        inner.classList.toggle("sg-marker--num", zeigen && !isLast);
        inner.textContent = !zeigen ? "" : isLast ? "🏁" : String(s.order);
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

  // Die Haarlinie der ganzen Runde. Einmal setzen, danach nie wieder anfassen.
  const shapeSig = (shape ?? []).length;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !shape?.length) return;
    setRoundShape(map, shape);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shapeSig]);

  // Etappen-Route zeichnen (ersetzt die Linie komplett – neue Etappe = neue Geometrie).
  const routeSig = (route ?? []).map((c) => c.join(",")).join("|");
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const src = map.getSource(ROUTE_SOURCE) as mapboxgl.GeoJSONSource | undefined;
    if (!src) return; // Style noch nicht da -> der load-Handler oben zieht es nach
    src.setData(routeFC(route ?? []));
    setNavTrim(map, progressRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeSig]);

  // Fortschritt: nur umfärben, nie die Geometrie neu setzen. Mapbox hält die Linie
  // bewusst konstant und rechnet den Trim im Shader – setData bei jedem GPS-Signal wäre
  // um ein Vielfaches teurer und würde auf dem Handy sichtbar ruckeln.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    setNavTrim(map, progress);
  }, [progress]);

  // Positions-Punkt: eigener DOM-Marker statt GeolocateControl. GeolocateControl zeigt
  // nur seinen eigenen internen Fix an und gibt der App keinen Zugriff auf den
  // Fix-Strom, den die Kamera unten braucht – hier ist der Fix ohnehin schon da
  // (useGeolocationWatch), der Marker folgt ihm nur.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !fix) return;
    const at: [number, number] = [fix.lng, fix.lat];

    // ZWEI Marker an derselben Stelle, und das ist der Kern der Sache. Mapbox legt seinen
    // ganzen Puck flach in die Kartenebene (pitchAlignment "map"), was bei ihren flacheren
    // Kameras stimmig ist; bei unseren 58 Grad wird der Punkt dabei zur gequetschten
    // Ellipse (am Bildschirm nachgesehen). Google Maps trennt stattdessen, und das ist die
    // bessere Lesart:
    //   Der KEGEL liegt flach auf der Strasse ("map"/"map") und zeigt perspektivisch nach
    //     vorn, wie ein Scheinwerfer. Nur so gehoert er zur Szene.
    //   Der PUNKT steht aufrecht zum Betrachter ("viewport") und bleibt dadurch immer ein
    //     sauberer Kreis, egal wie steil die Kamera steht.
    if (!coneRef.current) {
      const coneEl = document.createElement("div");
      coneEl.className = "sg-nav-cone";
      // Radius 90 statt 34: Die 58 Grad Neigung druecken die Laenge auf cos(58) zusammen,
      // aus 34 px wurden am Bildschirm gemessene 18 px und der Kegel verschwand hinter dem
      // Punkt (der mit Ring 24 px misst). Bei 90 bleiben 48 px sichtbare Laenge.
      //
      // Der Verlauf laeuft ueber gradientUnits="userSpaceOnUse" von der SPITZE (0,0) nach
      // aussen. Mit den Standard-Einheiten bezieht sich cx/cy auf die Bounding-Box des
      // Pfads, der hellste Punkt saesse dann mitten im Kegel statt am Radl.
      coneEl.innerHTML = `<svg viewBox="-90 -90 180 180" aria-hidden="true">
          <defs>
            <radialGradient id="sg-nav-cone-grad" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="90">
              <stop offset="0%" stop-color="#2563d9" stop-opacity="0.9" />
              <stop offset="35%" stop-color="#2563d9" stop-opacity="0.5" />
              <stop offset="100%" stop-color="#2563d9" stop-opacity="0" />
            </radialGradient>
          </defs>
          <path d="M 0 0 L -38 -81.6 A 90 90 0 0 1 38 -81.6 Z" fill="url(#sg-nav-cone-grad)" />
        </svg>`;
      coneRef.current = new mapboxgl.Marker({
        element: coneEl,
        rotationAlignment: "map",
        pitchAlignment: "map",
      })
        .setLngLat(at)
        .addTo(map);
    } else {
      coneRef.current.setLngLat(at);
    }

    if (!puckRef.current) {
      const el = document.createElement("div");
      el.className = "sg-nav-puck";
      puckRef.current = new mapboxgl.Marker({ element: el, pitchAlignment: "viewport" })
        .setLngLat(at)
        .addTo(map);
    } else {
      puckRef.current.setLngLat(at);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fix?.lng, fix?.lat]);

  // ——— Kurs des Kegels: weich, und im Gleichschritt mit der Kamera ————————————
  // Der Kurs wird nur einmal je GPS-Signal berechnet, etwa einmal pro Sekunde. Ihn direkt
  // zu setzen liesse den Kegel springen, waehrend die Kamera daneben noch eine Sekunde
  // weiterdreht (easeTo, FOLLOW_EASE_MS) – beide liefen gegeneinander. Deshalb eine eigene
  // Bild-fuer-Bild-Schleife, deren ZIEL davon abhaengt, wer gerade fuehrt:
  //
  //   Folge-Modus: Ziel ist map.getBearing() bei JEDEM Bild. Weil der Marker mit
  //     rotationAlignment "map" laeuft, rechnet Mapbox Kurs minus Karten-Ausrichtung, und
  //     die bleibt exakt null: Der Kegel liegt ruhig nach vorn, waehrend sich die Karte
  //     unter ihm dreht. Kein Zittern, weil beide dieselbe Zahl benutzen.
  //   Frei verschoben: Ziel ist der geglaettete Kurs aus bike-nav-core, dem der Kegel
  //     weich nachzieht. Hier SOLL man ihn sich drehen sehen.
  //
  // Die Schleife haelt an, sobald sie angekommen ist, und startet neu, wenn ein neuer Kurs
  // hereinkommt: sie laeuft also nur, waehrend sich wirklich etwas bewegt.
  const shownBearingRef = useRef(bearingDeg);
  const bearingRafRef = useRef<number | null>(null);
  const bearingTargetRef = useLatestRef(bearingDeg);
  const followingRef = useLatestRef(following);

  useEffect(() => {
    if (!mapRef.current) return;
    if (reducedMotion()) {
      shownBearingRef.current = bearingDeg;
      coneRef.current?.setRotation(bearingDeg);
      return;
    }
    if (bearingRafRef.current != null) return; // laeuft schon, das neue Ziel reicht

    const step = () => {
      const m = mapRef.current;
      if (!m || !coneRef.current) {
        bearingRafRef.current = null;
        return;
      }
      const goal = followingRef.current ? m.getBearing() : bearingTargetRef.current;
      const from = shownBearingRef.current;
      // Ueber den kurzen Bogen, sonst dreht der Kegel bei 359 -> 1 einmal ganz herum.
      const delta = unwrapDegrees(from, goal) - from;
      if (Math.abs(delta) < 0.2) {
        shownBearingRef.current = ((goal % 360) + 360) % 360;
        coneRef.current.setRotation(shownBearingRef.current);
        bearingRafRef.current = null;
        return;
      }
      // 0,14 je Bild: bei 60 Bildern/s rund 95 Prozent nach etwa 350 ms. Schnell genug, um
      // der Kamera zu folgen, langsam genug, um nicht zu huepfen.
      const next = from + delta * 0.14;
      shownBearingRef.current = ((next % 360) + 360) % 360;
      coneRef.current.setRotation(shownBearingRef.current);
      bearingRafRef.current = requestAnimationFrame(step);
    };
    bearingRafRef.current = requestAnimationFrame(step);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bearingDeg, following]);

  useEffect(
    () => () => {
      if (bearingRafRef.current != null) cancelAnimationFrame(bearingRafRef.current);
    },
    [],
  );

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
      // eigentlich abstellen soll – deshalb hier explizit auf 0.
      duration: reducedMotion() ? 0 : FOLLOW_EASE_MS,
      easing: (t) => t,
      padding: {
        top: topPaddingFor(map.getContainer().clientHeight, paddingBottomRef.current),
        right: 0,
        left: 0,
        bottom: paddingBottomRef.current,
      },
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
        padding: {
          top: topPaddingFor(map.getContainer().clientHeight, paddingBottomRef.current),
          right: 0,
          left: 0,
          bottom: paddingBottomRef.current,
        },
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
