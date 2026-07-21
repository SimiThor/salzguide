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
  DEFAULT_INTRO_CAMERA,
  type IntroKeyframe,
} from "@/lib/intro-camera";

const TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

// Nur Rot (ROUTE_LINE), KEINE weiße Kontur - wie Antons Vorlage. Nur eine hauchdünne
// dunkle Kante zur Schärfe auf dem Luftbild. Kopf = roter Punkt mit weißem Ring.
const INTRO_EDGE = "rgba(0,0,0,0.45)";
const HEAD_SOURCE = "sg-head";
const HEAD_LAYER = "sg-head-dot";

// Endkarte kurz vor Schluss: Spot-Name + die wichtigsten Werte + klein SalzGuide.
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

    const applyFrame = (kf: IntroKeyframe) => {
      map.jumpTo({
        center: kf.center,
        zoom: kf.zoom,
        pitch: kf.pitch,
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

    map.on("load", () => {
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

      applyFrame(first);

      window.__introFrameCount = keyframes.length;
      window.__introFps = effectiveFps;
      window.__introSeek = (i: number) => {
        const idx = Math.max(0, Math.min(keyframes.length - 1, Math.round(i)));
        applyFrame(keyframes[idx]);
      };
      window.__introWaitIdle = () =>
        new Promise<void>((resolve) => {
          if (map.areTilesLoaded()) resolve();
          else map.once("idle", () => resolve());
        });
      window.__introReady = true;

      // Echtzeit-Vorschau für menschliche Besucher (Skript setzt __introDriven, übernimmt).
      const durMs = durationSec * 1000;
      let start = 0;
      const tick = (now: number) => {
        if (window.__introDriven) return;
        if (!start) start = now;
        const t = Math.min(1, (now - start) / durMs);
        applyFrame(keyframes[Math.round(t * (keyframes.length - 1))]);
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
      {/* Endkarte: Spot-Name + wichtigste Werte + klein SalzGuide. Blendet kurz vor Schluss
          ein (Opacity per applyFrame). Sonst KEIN Logo im Video. */}
      <div
        ref={cardRef}
        style={{
          position: "fixed",
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 9,
          opacity: 0,
          pointerEvents: "none",
          padding: "120px 28px 72px",
          background:
            "linear-gradient(to top, rgba(0,0,0,0.6), rgba(0,0,0,0.22) 45%, transparent)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 12,
          textAlign: "center",
          fontFamily: "Inter, system-ui, sans-serif",
        }}
      >
        <div
          style={{
            color: "#fff",
            fontWeight: 700,
            fontSize: 44,
            lineHeight: 1.05,
            letterSpacing: "-0.02em",
            textShadow: "0 2px 18px rgba(0,0,0,0.6)",
          }}
        >
          {meta.name}
        </div>
        {statsParts.length > 0 && (
          <div
            style={{
              color: "rgba(255,255,255,0.94)",
              fontWeight: 500,
              fontSize: 20,
              letterSpacing: "0.01em",
              textShadow: "0 1px 10px rgba(0,0,0,0.55)",
            }}
          >
            {statsParts.join("   ·   ")}
          </div>
        )}
        <div
          style={{
            marginTop: 6,
            color: "rgba(255,255,255,0.82)",
            fontWeight: 700,
            fontSize: 15,
            letterSpacing: "0.02em",
            textShadow: "0 1px 8px rgba(0,0,0,0.5)",
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
