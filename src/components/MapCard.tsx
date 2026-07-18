"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence } from "framer-motion";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import SpotMap, { type MapMarker } from "./SpotMap";
import MapPopover, { MapPopoverClose } from "./MapPopover";
import { useIsMounted } from "@/lib/use-is-mounted";

// Vorschau-Karte, die beim Antippen eines Markers erscheint: Foto/Emoji + Titel +
// Kurzbeschreibung. Funktioniert eingebettet UND im Vollbild (MapPopover).
//
// Dass die Zeile weiterführt, sagt das Winkel-Zeichen am Ende — so schreibt iOS es in
// jede Liste. Vorher stand dort „Ansehen →" in Rot: ein Pfeil, den Apple nirgends
// verwendet, und ein Wort, das die Zeile ohnehin schon versprach. Das Wort lebt weiter
// als Vorlese-Beschriftung des Links, wo es tatsächlich gebraucht wird.
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
    <MapPopover fullscreen={safeBottom}>
      <Link
        href={`/spot/${marker.slug}`}
        aria-label={`${marker.title ?? ""} – ${viewLabel}`}
        className="flex min-w-0 flex-1 items-center gap-3 p-2.5 pr-1.5 active:opacity-80"
      >
        {marker.imageUrl ? (
          <Image
            src={marker.imageUrl}
            alt=""
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
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-semibold text-ink">
            {marker.title}
          </span>
          {marker.subtitle && (
            <span className="mt-0.5 block truncate text-[13px] leading-snug text-muted">
              {marker.subtitle}
            </span>
          )}
        </span>
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="shrink-0 text-black/25"
          aria-hidden
        >
          <path d="m9 5 7 7-7 7" />
        </svg>
      </Link>
      <MapPopoverClose onClick={onClose} label={closeLabel} />
    </MapPopover>
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
  const mounted = useIsMounted();
  const [sel, setSel] = useState<string | null>(null);

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
                className="absolute left-1/2 z-10 max-w-[60%] -translate-x-1/2 truncate rounded-full bg-white/90 px-3.5 py-1.5 text-sm font-medium text-ink ring-1 ring-black/5 backdrop-blur"
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
