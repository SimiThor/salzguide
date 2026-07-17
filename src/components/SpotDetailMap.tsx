"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { useTranslations } from "next-intl";
import SpotMap, { type SpotPoi } from "./SpotMap";
import ElevationProfile from "./ElevationProfile";
import type { ElevationProfile as Profile } from "@/lib/admin-actions";
import { coordAtFraction } from "@/lib/geo";
import { poiEmoji } from "@/lib/poi";

const CARD =
  "rounded-[18px] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_32px_-20px_rgba(0,0,0,0.28)]";

type Marker = {
  lat: number;
  lng: number;
  emoji?: string | null;
  title?: string;
  slug: string;
};

// Schlüssel eines Punkts (deckt sich mit SpotMap): "kind:lng,lat".
const poiKey = (p: SpotPoi) => `${p.kind}:${p.lng},${p.lat}`;

// Kleines iOS-Kärtchen unten, wenn ein Kartenpunkt angetippt ist (Start/Ziel, Wasser,
// Hütte, Parkplatz). Slide-up wie die Vorschau auf der Gespeichert-Karte. Kein Link —
// reine Info: getöntes Symbol + Name (falls vorhanden) + lokalisierte Gattung.
function PoiCard({
  poi,
  onClose,
  closeLabel,
  safeBottom = false,
}: {
  poi: SpotPoi;
  onClose: () => void;
  closeLabel: string;
  safeBottom?: boolean;
}) {
  const emoji = poiEmoji(poi.kind, poi.subtype);
  return (
    <div
      className="pointer-events-none absolute inset-x-3 z-[5]"
      style={safeBottom ? { bottom: "calc(env(safe-area-inset-bottom) + 14px)" } : { bottom: 12 }}
    >
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 16 }}
        transition={{ type: "spring", stiffness: 440, damping: 34 }}
        className="pointer-events-auto mx-auto flex max-w-sm items-center rounded-[16px] bg-white/95 pr-2 shadow-[0_14px_44px_-12px_rgba(0,0,0,0.45)] ring-1 ring-black/5 backdrop-blur-xl"
      >
        <div className={`sg-poi-card sg-poi-card--${poi.kind} min-w-0 flex-1`}>
          <span className="sg-poi-card__icon" aria-hidden>
            {emoji}
          </span>
          <span className="sg-poi-card__text">
            {poi.name ? (
              <>
                <span className="sg-poi-card__name truncate">{poi.name}</span>
                {poi.label && <span className="sg-poi-card__type truncate">{poi.label}</span>}
              </>
            ) : (
              <span className="sg-poi-card__name truncate">{poi.label}</span>
            )}
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={closeLabel}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-black/5 text-ink active:scale-90"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </motion.div>
    </div>
  );
}

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
  // Welcher Kartenpunkt ist gerade gewählt (zeigt unten das Kärtchen). null = keiner.
  const [selected, setSelected] = useState<SpotPoi | null>(null);

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
  const startLabel = t("poi.start");
  const finishLabel = t("poi.finish");
  const selKey = selected ? poiKey(selected) : null;

  // Gemeinsame Props, damit Inline- und Vollbild-Karte identisch tickt.
  const poiProps = {
    poi,
    onPoiSelect: setSelected,
    selectedPoiKey: selKey,
    startLabel,
    finishLabel,
    // Tippen auf die leere Karte schließt das Kärtchen.
    onMapClick: () => setSelected(null),
  } as const;

  // fitBounds-Padding reserviert die Ecken mit den Karten-Buttons (Zoom/Zentrieren/
  // Standort oben rechts, Vollbild oben links) -> Start-/Ziel-Marker landen NEBEN
  // statt unter den Buttons.
  const mapPadding = { top: 56, right: 70, bottom: 40, left: 40 };

  return (
    <>
      {/* Inline-Karte */}
      <div className={`${CARD} relative h-60 overflow-hidden`}>
        <SpotMap
          markers={markers}
          route={route}
          highlight={hoverCoord}
          center={center}
          zoom={13}
          padding={mapPadding}
          cooperative
          mapClass="sg-ctrl-top"
          onFullscreen={() => setFullscreen(true)}
          {...poiProps}
        />
        <AnimatePresence>
          {selected && (
            <PoiCard
              key={selKey}
              poi={selected}
              onClose={() => setSelected(null)}
              closeLabel={t("elevation.close")}
            />
          )}
        </AnimatePresence>
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
              highlight={null}
              center={center}
              zoom={13}
              padding={mapPadding}
              mapClass="sg-ctrl-safe"
              {...poiProps}
            />

            <AnimatePresence>
              {selected && (
                <PoiCard
                  key={selKey}
                  poi={selected}
                  onClose={() => setSelected(null)}
                  closeLabel={t("elevation.close")}
                  safeBottom
                />
              )}
            </AnimatePresence>

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
