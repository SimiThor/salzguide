"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import SpotMap, { type MapMarker } from "./SpotMap";

// Vorschau-Karte, die beim Antippen eines Markers erscheint (Foto/Emoji + Titel +
// „Ansehen"). iOS-Slide-up, funktioniert eingebettet UND im Vollbild.
function MarkerPreview({
  marker,
  onClose,
  viewLabel,
  closeLabel,
  safeBottom = false,
}: {
  marker: MapMarker;
  onClose: () => void;
  viewLabel: string;
  closeLabel: string;
  safeBottom?: boolean;
}) {
  return (
    <div
      className="pointer-events-none absolute inset-x-3 z-10"
      style={
        safeBottom
          ? { bottom: "calc(env(safe-area-inset-bottom) + 14px)" }
          : { bottom: 12 }
      }
    >
      <motion.div
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 18 }}
        transition={{ type: "spring", stiffness: 440, damping: 34 }}
        className="pointer-events-auto mx-auto flex max-w-sm items-center gap-3 rounded-[16px] bg-white/95 p-2.5 shadow-[0_14px_44px_-12px_rgba(0,0,0,0.45)] ring-1 ring-black/5 backdrop-blur-xl"
      >
        <Link
          href={`/spot/${marker.slug}`}
          className="flex min-w-0 flex-1 items-center gap-3 active:opacity-80"
        >
          {marker.imageUrl ? (
            <Image
              src={marker.imageUrl}
              alt={marker.title ?? ""}
              width={56}
              height={48}
              sizes="56px"
              className="h-12 w-14 shrink-0 rounded-[10px] object-cover"
            />
          ) : (
            <span className="flex h-12 w-14 shrink-0 items-center justify-center rounded-[10px] bg-gradient-to-br from-accent/15 to-muted/15 text-2xl">
              {marker.emoji ?? "📍"}
            </span>
          )}
          <span className="min-w-0">
            <span className="block truncate text-[15px] font-semibold text-ink">
              {marker.title}
            </span>
            <span className="text-[13px] font-semibold text-accent">
              {viewLabel} →
            </span>
          </span>
        </Link>
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

// Wiederverwendbare Karten-Card mit Controls (oben-rechts) + Vollbild (Portal).
// enablePreview: Marker werden antippbar -> Vorschau-Karte zum Öffnen des Spots.
export default function MapCard({
  markers,
  title,
  className,
  center,
  zoom,
  enablePreview = false,
}: {
  markers: MapMarker[];
  title?: string;
  className?: string;
  center?: [number, number];
  zoom?: number;
  enablePreview?: boolean;
}) {
  const t = useTranslations("Detail");
  const [fullscreen, setFullscreen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [sel, setSel] = useState<string | null>(null);

  useEffect(() => setMounted(true), []);

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

  const selected = enablePreview
    ? (markers.find((m) => m.slug === sel) ?? null)
    : null;
  // Interaktions-Props nur, wenn Vorschau aktiv (Detailseiten-Karte bleibt unberührt).
  const interactive = enablePreview
    ? {
        onMarkerClick: (slug: string) => setSel(slug),
        selectedSlug: sel,
        onMapClick: () => setSel(null),
      }
    : {};

  return (
    <>
      <div className={`relative ${className ?? ""}`}>
        <SpotMap
          markers={markers}
          center={center}
          zoom={zoom}
          cooperative
          mapClass="sg-ctrl-top"
          onFullscreen={() => setFullscreen(true)}
          {...interactive}
        />
        <AnimatePresence>
          {selected && (
            <MarkerPreview
              key={selected.slug}
              marker={selected}
              onClose={() => setSel(null)}
              viewLabel={t("view")}
              closeLabel={t("elevation.close")}
            />
          )}
        </AnimatePresence>
      </div>

      {mounted &&
        fullscreen &&
        createPortal(
          <div className="fixed inset-0 z-[90] bg-cream">
            <SpotMap
              markers={markers}
              center={center}
              zoom={zoom}
              mapClass="sg-ctrl-safe"
              {...interactive}
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

            {title && (
              <div
                className="absolute left-1/2 z-10 max-w-[60%] -translate-x-1/2 truncate rounded-full bg-white/90 px-3.5 py-1.5 text-sm font-semibold text-ink shadow-md ring-1 ring-black/5 backdrop-blur"
                style={{ top: "calc(env(safe-area-inset-top) + 14px)" }}
              >
                {title}
              </div>
            )}

            <AnimatePresence>
              {selected && (
                <MarkerPreview
                  key={selected.slug}
                  marker={selected}
                  onClose={() => setSel(null)}
                  viewLabel={t("view")}
                  closeLabel={t("elevation.close")}
                  safeBottom
                />
              )}
            </AnimatePresence>
          </div>,
          document.body,
        )}
    </>
  );
}
