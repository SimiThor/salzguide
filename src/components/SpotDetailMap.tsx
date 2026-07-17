"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import SpotMap, { type SpotPoi } from "./SpotMap";
import ElevationProfile from "./ElevationProfile";
import type { ElevationProfile as Profile } from "@/lib/admin-actions";
import { coordAtFraction } from "@/lib/geo";

const CARD =
  "rounded-[18px] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_32px_-20px_rgba(0,0,0,0.28)]";

type Marker = {
  lat: number;
  lng: number;
  emoji?: string | null;
  title?: string;
  slug: string;
};

export default function SpotDetailMap({
  route,
  elevation,
  marker,
  poi,
  center,
  title,
}: {
  route: [number, number][] | null;
  elevation: Profile | null;
  marker: Marker | null;
  poi?: SpotPoi[];
  center?: [number, number];
  title: string;
}) {
  const t = useTranslations("Detail");
  const [hoverF, setHoverF] = useState<number | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  // Body-Scroll sperren + Esc schliesst im Vollbild
  useEffect(() => {
    if (!fullscreen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFullscreen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [fullscreen]);

  const hoverCoord = route ? coordAtFraction(route, hoverF) : null;
  const markers = route || !marker ? [] : [marker];

  // fitBounds-Padding reserviert die Ecken mit den Karten-Buttons (Zoom/Zentrieren/
  // Standort oben rechts, Vollbild oben links) -> Start-/Ziel-Marker landen NEBEN
  // statt unter den Buttons.
  const mapPadding = { top: 56, right: 70, bottom: 40, left: 40 };

  return (
    <>
      {/* Inline-Karte */}
      <div className={`${CARD} h-60 overflow-hidden`}>
        <SpotMap
          markers={markers}
          route={route}
          poi={poi}
          highlight={hoverCoord}
          center={center}
          zoom={13}
          padding={mapPadding}
          cooperative
          mapClass="sg-ctrl-top"
          onFullscreen={() => setFullscreen(true)}
        />
      </div>

      {/* Interaktives Höhenprofil */}
      {elevation && <ElevationProfile profile={elevation} onHover={setHoverF} />}

      {/* Vollbild-Karte (zum Wandern) */}
      {mounted &&
        fullscreen &&
        createPortal(
          <div className="fixed inset-0 z-[90] bg-cream">
            <SpotMap
              markers={markers}
              route={route}
              poi={poi}
              highlight={null}
              center={center}
              zoom={13}
              padding={mapPadding}
              mapClass="sg-ctrl-safe"
            />

            <button
              type="button"
              onClick={() => setFullscreen(false)}
              aria-label={t("elevation.close")}
              className="absolute left-4 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-white/90 text-ink shadow-md ring-1 ring-black/5 backdrop-blur active:scale-95"
              style={{ top: "calc(env(safe-area-inset-top) + 12px)" }}
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
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>

            <div
              className="absolute left-1/2 z-10 max-w-[60%] -translate-x-1/2 truncate rounded-full bg-white/90 px-3.5 py-1.5 text-sm font-semibold text-ink shadow-md ring-1 ring-black/5 backdrop-blur"
              style={{ top: "calc(env(safe-area-inset-top) + 14px)" }}
            >
              {title}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
