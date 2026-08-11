"use client";

import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { useEffect, useRef } from "react";
import {
  ROUTE_SOURCE,
  ROUTE_LAYER_OUT,
  ROUTE_LAYER_LINE,
  ROUTE_LINE,
  NO_TRANSITION,
  routeFC,
  setTrim,
} from "@/lib/route-anim";
import {
  buildIntroCameraPath,
  smoothSafePitch,
  sightlineSlack,
  DEFAULT_INTRO_CAMERA,
  type IntroKeyframe,
} from "@/lib/intro-camera";
import { loadTerrainSampler } from "@/lib/terrain-sampler";
import { outboundRoute } from "@/lib/geo";

const TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

// --- Terrain-Sicherheit: die Kamera darf nie in einen Berg tauchen ODER hinter einen schauen ---
// Zwei Regeln, ein Mittel. (a) Crash-Schutz: über 3D-Terrain rechnet Mapbox die Kamera
// (hinter+über dem Ziel) bei steilem Pitch manchmal UNTER die Geländeoberfläche -> das Bild
// bricht. (b) Verdeckungs-Schutz: die Kamera kann sicher schweben und trotzdem ragt ein Grat
// in die SICHTLINIE zwischen Kamera und Kopf-Punkt -> der Punkt zeichnet unsichtbar hinter
// dem Berg weiter. Lösung für beides: pro Frame prüfen, wo die Kamera beim gewünschten Pitch
// landen würde, und den Pitch nur so weit abflachen, dass sie mit Abstand über dem Gelände
// bleibt UND freie Sicht auf den Punkt hat. Flacher = die Kamera steigt und schaut steiler
// von oben, genau der cinematische Reflex (wie Apple Maps). Alles bleibt im jumpTo-Modell
// -> Komposition/Padding unverändert.
const TERRAIN_CLEARANCE_M = 350; // Mindestabstand Kamera <-> höchstes Gelände im Blickfeld
const LOS_CLEARANCE_M = 120; // Mindest-Luft zwischen Sichtlinie und Gelände dazwischen
const LOS_TAPER_M = 300; // auf den letzten Metern vorm Punkt blendet die Forderung auf 0 aus
const LOS_STEP_M = 35; // Abtast-Schritt entlang der Sichtlinie (DEM ~7 m/px -> reichlich fein)
const PITCH_FLOOR = 8; // ganz flach ist erlaubt (crasht nie, sieht alles), bleibt minimal 3D
const PITCH_SCAN_STEP = 1; // feine 1-Grad-Abtastung -> keine Treppen in der Roh-Kurve
const PITCH_SMOOTH_FRAC = 0.03; // Glättungs-Radius als Anteil der Frames (~9 bei 300) -> weich

// Nur Rot (ROUTE_LINE), KEINE weiße Kontur - wie Antons Vorlage. Nur eine hauchdünne
// dunkle Kante zur Schärfe auf dem Luftbild. Kopf = roter Punkt mit weißem Ring.
const INTRO_EDGE = "rgba(0,0,0,0.45)";
const HEAD_SOURCE = "sg-head";
const HEAD_LAYER = "sg-head-dot";

// Mapbox GL v3 beleuchtet 2D-Layer (circle/line) über dem 3D-Terrain mit dem Szenenlicht.
// circle-/line-emissive-strength steht ab Werk auf 0 -> das Rot wird vom Licht abgedunkelt
// und wirkt leicht durchscheinend/billig. 1 = der Layer leuchtet in seiner vollen Eigenfarbe,
// unabhängig vom Licht. EINHEITLICH auf Punkt UND Linie, damit das Rot überall gleich satt ist.
const MAP_EMISSIVE = 1;

// Anteil des Bildes, der unten frei bleibt (Padding). Dadurch sitzt der rote Kopf-Punkt bei
// (1 - HEAD_PAD_FRAC)/2 ≈ 39 % von oben.
const HEAD_PAD_FRAC = 0.22;

// Titelblock-MITTE bei 1/4 von oben. Bewusst ENTKOPPELT vom Kopf-Punkt (~39 %): so bleibt
// zwischen Titel und Strecke genug Weißraum (der Titel soll nicht knapp über der Route kleben).
const TITLE_MID_FRAC = 0.25;

// Titelkarte oben (oberes Drittel, über dem Kopf-Punkt): Spot-Name + wichtigste Werte + klein
// SalzGuide, blendet kurz vor Schluss ein.
export type IntroMeta = {
  name: string;
  distanceKm: number | null;
  ascentM: number | null;
  duration: string | null;
};

// Weiche 0->1-Blende zwischen a und b (smoothstep).
const smoothstep = (a: number, b: number, x: number) => {
  const tt = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return tt * tt * (3 - 2 * tt);
};

// Österreich-Orthofoto von basemap.at (offiziell, kostenlos), OHNE Beschriftungen/Marker:
// leerer Style, nur die Luftbild-Kacheln. Das 3D-Relief kommt von Mapbox-Terrain (unten).
const BASEMAP_STYLE = {
  version: 8,
  sources: {
    basemap: {
      type: "raster",
      tiles: [
        "https://mapsneu.wien.gv.at/basemap/bmaporthofoto30cm/normal/google3857/{z}/{y}/{x}.jpeg",
        "https://maps.wien.gv.at/basemap/bmaporthofoto30cm/normal/google3857/{z}/{y}/{x}.jpeg",
      ],
      tileSize: 256,
      maxzoom: 19,
      attribution: "© basemap.at",
    },
  },
  layers: [
    { id: "bg", type: "background", paint: { "background-color": "#0c1410" } },
    { id: "basemap", type: "raster", source: "basemap" },
  ],
} as unknown as mapboxgl.StyleSpecification;

// Hooks, über die das Render-Skript (Playwright) diese Seite Frame für Frame steuert.
declare global {
  interface Window {
    __introReady?: boolean;
    __introFrameCount?: number;
    __introFps?: number;
    __introSeek?: (i: number) => void;
    __introWaitIdle?: () => Promise<void>;
    __introDriven?: boolean;
    // Titelkarte ein-/ausblenden: für die "clean"-Variante (ohne Text-Overlay) blendet das
    // Render-Skript sie pro Frame kurz aus und schießt ein zweites, sauberes Bild.
    __introSetCard?: (visible: boolean) => void;
    // Ist die Titelkarte in diesem Frame überhaupt sichtbar? Sagt dem Render-Skript, wann
    // sich der zweite Screenshot lohnt und wann er reine Rechenzeit wäre.
    __introCardVisible?: () => boolean;
    // Grund, warum die Karte NICHT bereit wurde. Ohne den bricht das Render-Skript nach
    // seiner Wartezeit ohne Begründung ab: Mapbox meldet Fehler nur über sein error-Event,
    // und ein Fehler im load-Handler landet als abgelehntes Promise im Nichts.
    __introError?: string;
  }
}

function headFC(coord: [number, number]) {
  return {
    type: "FeatureCollection" as const,
    features: [
      { type: "Feature" as const, geometry: { type: "Point" as const, coordinates: coord }, properties: {} },
    ],
  };
}

// Vollflächige 3D-Satellitenkarte (basemap.at + Terrain), deren Kamera ruhig dem Verlauf
// der Route folgt. Geteilt mit der Live-Karte ist nur die Trim-Technik (route-anim.ts).
export default function IntroRenderMap({
  route,
  meta,
  seconds,
  fps,
}: {
  route: [number, number][];
  meta: IntroMeta;
  seconds?: number;
  fps?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !TOKEN) {
      // Fehlt der Token im Build, blieb die Seite bisher wortlos leer.
      if (!TOKEN) window.__introError = "NEXT_PUBLIC_MAPBOX_TOKEN fehlt in diesem Build.";
      return;
    }
    mapboxgl.accessToken = TOKEN;

    const cfg = {
      ...(seconds ? { durationSec: seconds } : {}),
      ...(fps ? { fps } : {}),
    };
    const effectiveFps = fps ?? DEFAULT_INTRO_CAMERA.fps;
    const durationSec = seconds ?? DEFAULT_INTRO_CAMERA.durationSec;
    // Bei hin/retour nur den Hinweg animieren (Rückweg wäre langweilig); Rundweg + Punkt-zu-
    // Punkt bleiben die ganze Route. Kamera-Pfad UND die gezeichnete Linie nutzen dieselbe
    // getrimmte Route. Die Werte (Länge/Höhe/Dauer) kommen unabhängig aus der VOLLEN Route.
    const animRoute = outboundRoute(route);
    const keyframes = buildIntroCameraPath(animRoute, cfg);
    const first = keyframes[0];

    // BEWUSST der nackte Konstruktor, NICHT tryCreateMap aus MapUnavailable.tsx: Diese
    // Karte läuft nur im Render-Browser auf dem GitHub-Runner. Fehlt DORT WebGL, muss
    // der Lauf laut scheitern (das Render-Skript wertet genau das aus) — ein leiser
    // Hinweis statt Karte ergäbe ein leeres Video, das erst im Live-Betrieb auffällt.
    const map = new mapboxgl.Map({
      container: el,
      style: BASEMAP_STYLE,
      center: first.center,
      zoom: first.zoom,
      pitch: first.pitch,
      bearing: first.bearing,
      interactive: false,
      preserveDrawingBuffer: true, // Pflicht: Canvas später auslesen
      fadeDuration: 0, // deterministische Frames
      projection: "mercator",
      attributionControl: false, // eigene, kleine Attribution unten
    });

    // Mapbox wirft bei fehlenden Kacheln oder abgelehntem Token KEINE Exception, sondern
    // feuert nur dieses Event. Ungehört ist es der Grund, warum ein toter Render aussieht
    // wie ein hängender. Ersten Fehler festhalten, spätere sind meist Folgefehler.
    map.on("error", (e) => {
      const msg = (e as { error?: { message?: string } })?.error?.message ?? "unbekannter Kartenfehler";
      if (!window.__introError) window.__introError = `Mapbox: ${msg}`;
    });

    // Kopf-Punkt sitzt im oberen Drittel (wie in der Vorlage), Route läuft darunter.
    const padBottom = () => Math.round(el.clientHeight * HEAD_PAD_FRAC);

    const applyFrame = (kf: IntroKeyframe, pitch: number = kf.pitch) => {
      map.jumpTo({
        center: kf.center,
        zoom: kf.zoom,
        pitch,
        bearing: kf.bearing,
        padding: { top: 0, right: 0, bottom: padBottom(), left: 0 },
      });
      setTrim(map, kf.trim);
      const src = map.getSource(HEAD_SOURCE) as mapboxgl.GeoJSONSource | undefined;
      src?.setData(headFC(kf.head));
      // Endkarte kurz vor Schluss einblenden (direkt am DOM -> synchron zum Frame).
      if (cardRef.current) {
        cardRef.current.style.opacity = String(smoothstep(0.78, 0.94, kf.trim));
      }
    };

    const setup = async () => {
      // Höhenrelief: echtes 3D, damit die Berge plastisch werden.
      if (!map.getSource("mapbox-dem")) {
        map.addSource("mapbox-dem", {
          type: "raster-dem",
          url: "mapbox://mapbox.mapbox-terrain-dem-v1",
          tileSize: 512,
          maxzoom: 14,
        });
      }
      map.setTerrain({ source: "mapbox-dem", exaggeration: 1.5 });
      if (!map.getLayer("sky")) {
        map.addLayer({
          id: "sky",
          type: "sky",
          paint: { "sky-type": "atmosphere", "sky-atmosphere-sun-intensity": 12 },
        });
      }

      // Route wie die App-Karte (weiße Kontur unter Rot), nur dicker. Kein weicher
      // Auslauf am Kopf: die Linie endet hart am Punkt. Trim läuft über dieselben
      // Layer-IDs wie die Live-Karte, damit setTrim() greift.
      map.addSource(ROUTE_SOURCE, { type: "geojson", data: routeFC(animRoute), lineMetrics: true });
      map.addLayer({
        id: ROUTE_LAYER_OUT,
        type: "line",
        source: ROUTE_SOURCE,
        paint: {
          "line-color": INTRO_EDGE,
          "line-width": 8.5,
          "line-emissive-strength": MAP_EMISSIVE,
          "line-opacity-transition": NO_TRANSITION,
        },
        layout: { "line-join": "round", "line-cap": "round" },
      });
      map.addLayer({
        id: ROUTE_LAYER_LINE,
        type: "line",
        source: ROUTE_SOURCE,
        paint: {
          "line-color": ROUTE_LINE,
          "line-width": 6.5,
          "line-emissive-strength": MAP_EMISSIVE,
          "line-opacity-transition": NO_TRANSITION,
        },
        layout: { "line-join": "round", "line-cap": "round" },
      });

      // Kopf-Punkt: roter Kreis mit weißem Ring, faces the camera.
      map.addSource(HEAD_SOURCE, { type: "geojson", data: headFC(first.head) });
      map.addLayer({
        id: HEAD_LAYER,
        type: "circle",
        source: HEAD_SOURCE,
        paint: {
          "circle-radius": 9,
          "circle-color": ROUTE_LINE,
          "circle-opacity": 1,
          "circle-stroke-width": 4.5,
          "circle-stroke-color": "#ffffff",
          "circle-stroke-opacity": 1,
          "circle-emissive-strength": MAP_EMISSIVE,
          "circle-pitch-alignment": "viewport",
        },
      });

      const waitIdle = () =>
        new Promise<void>((resolve) => {
          if (map.areTilesLoaded()) resolve();
          else map.once("idle", () => resolve());
        });

      // --- Terrain-sichere Pitch-Kurve vorab berechnen (siehe Konstanten oben) ---
      // Ob die Kamera in einen Berg fliegt, entscheidet die Höhe UNTER der Kamera - die kann
      // NEBEN oder GEGENÜBER der Route liegen, nicht nur entlang. queryTerrainElevation kann
      // solche off-screen-Punkte nicht, darum das DEM der ganzen Umgebung selbst dekodieren.
      const EXAGG = 1.5; // muss zur setTerrain-Überhöhung passen
      const bb = new mapboxgl.LngLatBounds();
      for (const kf of keyframes) {
        bb.extend(kf.center);
        bb.extend(kf.head);
      }
      const bsw = bb.getSouthWest();
      const bne = bb.getNorthEast();
      const cosLat = Math.max(0.2, Math.cos((bsw.lat * Math.PI) / 180));
      const padDeg = 0.045; // ~5 km rundum: deckt auch Berge neben/gegenüber der Route ab
      const box = {
        w: bsw.lng - padDeg / cosLat,
        e: bne.lng + padDeg / cosLat,
        s: bsw.lat - padDeg,
        n: bne.lat + padDeg,
      };
      let elevAt: (lng: number, lat: number) => number = () => NaN;
      if (TOKEN) {
        try {
          elevAt = await loadTerrainSampler(box, TOKEN);
        } catch {
          /* ohne DEM kein Schutz, aber auch keine Verschlechterung */
        }
      }

      // Kamera-Höhe terrain-BEWUSST machen: getFreeCameraOptions liefert die echte Höhe
      // (Gelände am Mittelpunkt + Kamera-Abstand) erst, wenn Terrain-Frames gerendert wurden.
      // Einmal die ganze Route flach überblicken und rendern -> danach stimmt die Höhe.
      const nextPaint = () =>
        new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
      map.fitBounds([[box.w, box.s], [box.e, box.n]], { padding: 20, pitch: 0, bearing: 0, duration: 0 });
      // Ohne Frist wartet das hier ewig, wenn die Kacheln nicht kommen (basemap.at drosselt
      // oder blockt die Rechenzentrums-IP des GitHub-Runners). Genau so sah der Abbruch
      // "kein __introReady" aus. Lieber laut scheitern als schweigend hängen: Ein Video aus
      // leeren Kacheln wäre schlimmer als gar keins, darum hier werfen statt weitermachen.
      const TILE_BUDGET_MS = 90_000;
      const gotTiles = await Promise.race([
        waitIdle().then(() => true),
        new Promise<boolean>((r) => setTimeout(() => r(false), TILE_BUDGET_MS)),
      ]);
      if (!gotTiles) {
        throw new Error(
          `Kartenkacheln wurden in ${TILE_BUDGET_MS / 1000}s nicht fertig (basemap.at erreichbar?).`,
        );
      }
      map.triggerRepaint();
      await nextPaint();

      // Gelände in GERENDERTEN Metern (DEM * Überhöhung), die Einheit von Kamera-Höhen.
      const groundAt = (lng: number, lat: number) => elevAt(lng, lat) * EXAGG;

      // Sicherheits-Spielraum eines Kamerastands in Metern; >= 0 heißt: dieser Pitch ist
      // erlaubt. Beide Regeln (siehe Konstanten oben) in einer Zahl: (a) Kamera-Höhe minus
      // Gelände UNTER der Kamera minus Mindestabstand, (b) knappste Luft entlang der
      // SICHTLINIE Kamera -> Kopf-Punkt. Kein DEM an einer Stelle -> als sicher behandeln.
      //
      // Flacherer Pitch hilft beweisbar BEIDEN Regeln: die Kamera steigt und rückt Richtung
      // Ziel-Senkrechte, und weil alte wie neue Sichtlinie im selben Ziel enden, liegt die
      // neue überall HÖHER. Deshalb darf die geglättete Kurve aus smoothSafePitch (immer
      // <= roher Grenze) beide Garantien übernehmen, ohne sie neu zu prüfen.
      const safetySlackAt = (kf: IntroKeyframe, pitch: number): number => {
        map.jumpTo({
          center: kf.center,
          zoom: kf.zoom,
          pitch,
          bearing: kf.bearing,
          padding: { top: 0, right: 0, bottom: padBottom(), left: 0 },
        });
        const cam = map.getFreeCameraOptions();
        if (!cam.position) return Infinity;
        const ll = cam.position.toLngLat();
        const camAlt = cam.position.toAltitude();
        const gCam = groundAt(ll.lng, ll.lat);
        const underCam = Number.isNaN(gCam) ? Infinity : camAlt - gCam - TERRAIN_CLEARANCE_M;
        if (underCam < 0) return underCam; // schon durchgefallen -> Sichtlinie sparen
        const gHead = groundAt(kf.head[0], kf.head[1]);
        const los = Number.isNaN(gHead)
          ? Infinity
          : sightlineSlack(
              { lng: ll.lng, lat: ll.lat, alt: camAlt },
              { lng: kf.head[0], lat: kf.head[1], alt: gHead },
              groundAt,
              { marginM: LOS_CLEARANCE_M, taperM: LOS_TAPER_M, stepM: LOS_STEP_M },
            );
        return Math.min(underCam, los);
      };
      // Steilster Pitch <= Vorgabe, der Crash- UND Verdeckungs-Schutz einhält.
      const safePitchFor = (kf: IntroKeyframe): number => {
        for (let p = kf.pitch; p > PITCH_FLOOR; p -= PITCH_SCAN_STEP) {
          if (safetySlackAt(kf, p) >= 0) return p;
        }
        return PITCH_FLOOR;
      };
      const rawSafe = keyframes.map(safePitchFor);
      const smoothR = Math.max(4, Math.round(keyframes.length * PITCH_SMOOTH_FRAC));
      const safePitch = smoothSafePitch(rawSafe, smoothR);

      applyFrame(first, safePitch[0]);

      window.__introFrameCount = keyframes.length;
      window.__introFps = effectiveFps;
      window.__introSeek = (i: number) => {
        const idx = Math.max(0, Math.min(keyframes.length - 1, Math.round(i)));
        applyFrame(keyframes[idx], safePitch[idx]);
      };
      window.__introWaitIdle = waitIdle;
      // Für die "clean"-Variante die Karte per VISIBILITY aus-/einblenden, NIE per display.
      // React setzt `display: flex` als Inline-Style; `style.display = ""` würde genau dieses
      // Inline-flex löschen -> die Karte fiele auf display:block zurück, die vertikale
      // Zentrierung (justify-center) verpufft und der Titel klebt wieder oben. visibility
      // lässt das Layout unangetastet.
      window.__introSetCard = (visible: boolean) => {
        if (cardRef.current) cardRef.current.style.visibility = visible ? "visible" : "hidden";
      };
      // Die Titelkarte blendet erst kurz vor Schluss ein (applyFrame). Solange ihre Deckkraft
      // exakt 0 ist, sind das Bild MIT und das Bild OHNE Karte Pixel für Pixel dasselbe, und
      // das Render-Skript kann sich den zweiten Screenshot sparen. Das betrifft rund drei
      // Viertel aller Frames, gemessen 393 Aufnahmen statt 600.
      window.__introCardVisible = () => Number(cardRef.current?.style.opacity ?? "0") > 0;
      window.__introReady = true;

      // Echtzeit-Vorschau für menschliche Besucher (Skript setzt __introDriven, übernimmt).
      const durMs = durationSec * 1000;
      let start = 0;
      const tick = (now: number) => {
        if (window.__introDriven) return;
        if (!start) start = now;
        const t = Math.min(1, (now - start) / durMs);
        const idx = Math.round(t * (keyframes.length - 1));
        applyFrame(keyframes[idx], safePitch[idx]);
        if (t >= 1) {
          start = 0;
          window.setTimeout(() => requestAnimationFrame(tick), 900);
        } else {
          requestAnimationFrame(tick);
        }
      };
      requestAnimationFrame(tick);
    };

    // Wirft der Aufbau, war das bisher ein abgelehntes Promise, das niemand las: keine
    // Meldung in der Konsole, kein Seitenfehler, nur eine Karte, die nie bereit wird.
    map.on("load", () => {
      void setup().catch((e: unknown) => {
        window.__introError = `Kartenaufbau abgebrochen: ${e instanceof Error ? e.message : String(e)}`;
      });
    });

    return () => map.remove();
  }, [route, seconds, fps]);

  // Wichtigste Werte, sprachneutral (Zahlen + Einheiten). Nur was vorhanden ist, max drei.
  const statsParts: string[] = [];
  if (meta.distanceKm != null) {
    statsParts.push(`${meta.distanceKm.toLocaleString("de-DE", { maximumFractionDigits: 1 })} km`);
  }
  // „254 hm" statt „↑ 254 m": Der Pfeil war das einzige Symbol auf der Karte und zog den
  // Blick auf sich, ohne etwas zu erklären. „hm" ist im Alpenraum die übliche Kurzform für
  // Höhenmeter und steht als unitElevation längst in messages/de.json, also sagt die App
  // auf der Spot-Seite schon dasselbe. Eine Schreibweise für beide Stellen.
  if (meta.ascentM != null) statsParts.push(`${Math.round(meta.ascentM)} hm`);
  if (meta.duration && meta.duration.trim()) statsParts.push(meta.duration.trim());

  return (
    <>
      <style
        dangerouslySetInnerHTML={{
          // Sauberer Look wie basemap.at: Kompass, Mapbox-Logo (Bild ist basemap.at, nicht
          // Mapbox) und der Next.js-Dev-Indikator raus. Die Text-Attribution unten bleibt.
          __html:
            ".mapboxgl-ctrl-compass,.mapboxgl-ctrl-logo{display:none!important}nextjs-portal{display:none!important}",
        }}
      />
      <div ref={containerRef} style={{ position: "fixed", inset: 0 }} />
      {/* Titelkarte im oberen Viertel (Mitte bei ~1/4, mit Luft zur Strecke darunter):
          Spot-Name + Werte + klein SalzGuide, zusammen als eine Gruppe. Blendet kurz vor
          Schluss ein (Opacity per applyFrame). Weicher Verlauf für Lesbarkeit. Sonst KEIN
          Logo im Video. */}
      <div
        ref={cardRef}
        style={{
          position: "fixed",
          left: 0,
          right: 0,
          top: 0,
          // Band vom oberen Rand bis 2×TITLE_MID_FRAC, Text darin ZENTRIERT (justify-center)
          // -> Textmitte exakt bei TITLE_MID_FRAC (1/4 von oben). Robust: unabhängig von der
          // Zeilenzahl und von der Viewport-Höhe, kein flex-end/border-box-Trick mehr.
          height: `${TITLE_MID_FRAC * 2 * 100}vh`,
          zIndex: 9,
          opacity: 0,
          pointerEvents: "none",
          padding: "0 28px",
          // Weicher Verlauf, der um die Textmitte (Bandmitte) am dunkelsten ist und nach oben
          // wie unten ausblendet -> Text lesbar, ohne Himmel/Strecke stark abzudunkeln.
          background:
            "linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,0.14) 34%, rgba(0,0,0,0.5) 50%, rgba(0,0,0,0.14) 66%, rgba(0,0,0,0) 100%)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 7,
          textAlign: "center",
          fontFamily: "Inter, system-ui, sans-serif",
        }}
      >
        <div
          style={{
            color: "#fff",
            fontWeight: 700,
            fontSize: 31,
            lineHeight: 1.06,
            letterSpacing: "-0.02em",
            textShadow: "0 2px 16px rgba(0,0,0,0.62)",
          }}
        >
          {meta.name}
        </div>
        {statsParts.length > 0 && (
          <div
            style={{
              color: "rgba(255,255,255,0.95)",
              fontWeight: 500,
              fontSize: 15,
              letterSpacing: "0.01em",
              textShadow: "0 1px 10px rgba(0,0,0,0.6)",
            }}
          >
            {statsParts.join("   ·   ")}
          </div>
        )}
        <div
          style={{
            marginTop: 4,
            color: "rgba(255,255,255,0.85)",
            fontWeight: 700,
            fontSize: 12.5,
            letterSpacing: "0.04em",
            textShadow: "0 1px 8px rgba(0,0,0,0.55)",
          }}
        >
          SalzGuide
        </div>
      </div>
      {/* Kleine, sichtbare Attribution (Bild: basemap.at, Relief: Mapbox). */}
      <div
        style={{
          position: "fixed",
          bottom: 12,
          left: 0,
          right: 0,
          zIndex: 10,
          textAlign: "center",
          color: "rgba(255,255,255,0.9)",
          fontFamily: "Inter, system-ui, sans-serif",
          fontSize: 12,
          textShadow: "0 1px 6px rgba(0,0,0,0.6)",
          pointerEvents: "none",
        }}
      >
        © basemap.at · © Mapbox
      </div>
    </>
  );
}
