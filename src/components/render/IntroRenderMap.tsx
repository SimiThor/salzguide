"use client";

import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { useEffect, useRef } from "react";
import { addRouteSourceAndLayers, setTrim } from "@/lib/route-anim";
import {
  buildIntroCameraPath,
  DEFAULT_INTRO_CAMERA,
  type IntroKeyframe,
} from "@/lib/intro-camera";

const TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

// Hooks, über die das Render-Skript (Playwright) diese Seite Frame für Frame steuert.
// Menschliche Besucher brauchen sie nicht; ohne Skript läuft eine Echtzeit-Vorschau.
declare global {
  interface Window {
    __introReady?: boolean;
    __introFrameCount?: number;
    __introSeek?: (i: number) => void;
    __introWaitIdle?: () => Promise<void>;
    __introDriven?: boolean;
  }
}

// Vollflächige 3D-Satellitenkarte, deren Kamera der sich zeichnenden Route folgt.
// Bewusst getrennt von SpotMap: hier zählt Kino (Terrain, Neigung, Flug), nicht
// Bedienbarkeit. Geteilt wird nur der Linien-Look über route-anim.ts.
export default function IntroRenderMap({ route }: { route: [number, number][] }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !TOKEN) return;
    mapboxgl.accessToken = TOKEN;

    const keyframes = buildIntroCameraPath(route);
    const first = keyframes[0];

    const map = new mapboxgl.Map({
      container: el,
      style: "mapbox://styles/mapbox/satellite-streets-v12",
      center: first.center,
      zoom: first.zoom,
      pitch: first.pitch,
      bearing: first.bearing,
      // Kamera an, Bedienung aus: der Renderer setzt jeden Frame selbst.
      interactive: false,
      // Pflicht, damit das Skript den GL-Canvas auslesen kann.
      preserveDrawingBuffer: true,
      // Keine weichen Label-/Kachel-Übergänge -> jeder Frame ist deterministisch.
      fadeDuration: 0,
      projection: "mercator",
      attributionControl: true,
    });

    const applyFrame = (kf: IntroKeyframe) => {
      map.jumpTo({
        center: kf.center,
        zoom: kf.zoom,
        pitch: kf.pitch,
        bearing: kf.bearing,
      });
      setTrim(map, kf.trim);
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
      map.setTerrain({ source: "mapbox-dem", exaggeration: 1.4 });
      // Himmel/Dunst für den schrägen Blick über die Gipfel.
      if (!map.getLayer("sky")) {
        map.addLayer({
          id: "sky",
          type: "sky",
          paint: {
            "sky-type": "atmosphere",
            "sky-atmosphere-sun-intensity": 12,
          },
        });
      }
      // Dieselbe rote Linie auf weißer Kontur wie die App-Karte (route-anim.ts).
      addRouteSourceAndLayers(map, route);
      applyFrame(first);

      // Steuer-Hooks fürs Skript bereitstellen.
      window.__introFrameCount = keyframes.length;
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

      // Echtzeit-Vorschau für menschliche Besucher (Skript setzt __introDriven und übernimmt).
      const durMs = DEFAULT_INTRO_CAMERA.durationSec * 1000;
      let start = 0;
      const tick = (now: number) => {
        if (window.__introDriven) return;
        if (!start) start = now;
        const t = Math.min(1, (now - start) / durMs);
        applyFrame(keyframes[Math.round(t * (keyframes.length - 1))]);
        if (t >= 1) {
          start = 0;
          window.setTimeout(() => requestAnimationFrame(tick), 900); // in Schleife
        } else {
          requestAnimationFrame(tick);
        }
      };
      requestAnimationFrame(tick);
    });

    return () => map.remove();
  }, [route]);

  return <div ref={containerRef} style={{ position: "fixed", inset: 0 }} />;
}
