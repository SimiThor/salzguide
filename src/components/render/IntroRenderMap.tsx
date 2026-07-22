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
  DEFAULT_INTRO_CAMERA,
  type IntroKeyframe,
} from "@/lib/intro-camera";
import { loadTerrainSampler } from "@/lib/terrain-sampler";

const TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

// --- Terrain-Sicherheit: die Kamera darf nie in einen Berg tauchen ---
// Über 3D-Terrain rechnet Mapbox die Kamera (hinter+über dem Ziel) bei steilem Pitch manchmal
// UNTER die Geländeoberfläche -> das Bild bricht. Lösung: pro Frame prüfen, wo die Kamera bei
// dem gewünschten Pitch landen würde, und den Pitch nur so weit abflachen, dass sie garantiert
// mit Abstand über dem Gelände bleibt. Flacher schauen über Bergen ist genau der cinematische
// Reflex (wie Apple Maps). Alles bleibt im jumpTo-Modell -> Komposition/Padding unverändert.
const TERRAIN_CLEARANCE_M = 350; // Mindestabstand Kamera <-> höchstes Gelände im Blickfeld
const PITCH_FLOOR = 8; // ganz flach ist erlaubt (crasht nie), bleibt aber minimal 3D
const PITCH_SCAN_STEP = 1; // feine 1-Grad-Abtastung -> keine Treppen in der Roh-Kurve
const PITCH_SMOOTH_FRAC = 0.03; // Glättungs-Radius als Anteil der Frames (~9 bei 300) -> weich

// Nur Rot (ROUTE_LINE), KEINE weiße Kontur - wie Antons Vorlage. Nur eine hauchdünne
// dunkle Kante zur Schärfe auf dem Luftbild. Kopf = roter Punkt mit weißem Ring.
const INTRO_EDGE = "rgba(0,0,0,0.45)";
const HEAD_SOURCE = "sg-head";
const HEAD_LAYER = "sg-head-dot";

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
    if (!el || !TOKEN) return;
    mapboxgl.accessToken = TOKEN;

    const cfg = {
      ...(seconds ? { durationSec: seconds } : {}),
      ...(fps ? { fps } : {}),
    };
    const effectiveFps = fps ?? DEFAULT_INTRO_CAMERA.fps;
    const durationSec = seconds ?? DEFAULT_INTRO_CAMERA.durationSec;
    const keyframes = buildIntroCameraPath(route, cfg);
    const first = keyframes[0];

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

    // Kopf-Punkt sitzt im oberen Drittel (wie in der Vorlage), Route läuft darunter.
    const padBottom = () => Math.round(el.clientHeight * 0.22);

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

    map.on("load", async () => {
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
      map.addSource(ROUTE_SOURCE, { type: "geojson", data: routeFC(route), lineMetrics: true });
      map.addLayer({
        id: ROUTE_LAYER_OUT,
        type: "line",
        source: ROUTE_SOURCE,
        paint: {
          "line-color": INTRO_EDGE,
          "line-width": 8.5,
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
          "circle-stroke-width": 4.5,
          "circle-stroke-color": "#ffffff",
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
      await waitIdle();
      map.triggerRepaint();
      await nextPaint();

      // Abstand = Kamera-Höhe minus Gelände UNTER der Kamera (gerendert, also *EXAGG).
      // Negativ = die Kamera steckt im Berg. Kein DEM an der Stelle -> als sicher behandeln.
      const clearanceAt = (kf: IntroKeyframe, pitch: number): number => {
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
        const g = elevAt(ll.lng, ll.lat);
        if (Number.isNaN(g)) return Infinity;
        return cam.position.toAltitude() - g * EXAGG;
      };
      // Steilster Pitch <= Vorgabe, bei dem die Kamera mit Abstand über dem Gelände bleibt.
      const safePitchFor = (kf: IntroKeyframe): number => {
        for (let p = kf.pitch; p > PITCH_FLOOR; p -= PITCH_SCAN_STEP) {
          if (clearanceAt(kf, p) >= TERRAIN_CLEARANCE_M) return p;
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
      window.__introSetCard = (visible: boolean) => {
        if (cardRef.current) cardRef.current.style.display = visible ? "" : "none";
      };
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
    });

    return () => map.remove();
  }, [route, seconds, fps]);

  // Wichtigste Werte, sprachneutral (Zahlen + Einheiten). Nur was vorhanden ist, max drei.
  const statsParts: string[] = [];
  if (meta.distanceKm != null) {
    statsParts.push(`${meta.distanceKm.toLocaleString("de-DE", { maximumFractionDigits: 1 })} km`);
  }
  if (meta.ascentM != null) statsParts.push(`↑ ${Math.round(meta.ascentM)} m`);
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
      {/* Titelkarte OBEN (oberes Drittel, über dem roten Kopf-Punkt bei ~39%): Spot-Name +
          Werte + klein SalzGuide, zusammen als eine Gruppe. Blendet kurz vor Schluss ein
          (Opacity per applyFrame). Verlauf von oben für Lesbarkeit. Sonst KEIN Logo im Video. */}
      <div
        ref={cardRef}
        style={{
          position: "fixed",
          left: 0,
          right: 0,
          top: 0,
          zIndex: 9,
          opacity: 0,
          pointerEvents: "none",
          padding: "54px 28px 44px",
          background:
            "linear-gradient(to bottom, rgba(0,0,0,0.62), rgba(0,0,0,0.2) 52%, transparent)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
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
