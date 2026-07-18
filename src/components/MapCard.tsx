"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import SpotMap, { type MapMarker } from "./SpotMap";
import SpotSheet from "./SpotSheet";
import type { SpotCardData } from "@/lib/spots";
import { useIsMounted } from "@/lib/use-is-mounted";

// Karten-Kachel: eingebettet eine reine Vorschau (antippen macht sie gross), im
// Vollbild eine echte Karte mit antippbaren Markern und dem Spot-Sheet aus Explore.
export default function MapCard({
  markers,
  title,
  className,
  center,
  zoom,
  spots,
  loggedIn = false,
  savedSlugs,
  onSavedChange,
}: {
  markers: MapMarker[];
  title?: string;
  className?: string;
  center?: [number, number];
  zoom?: number;
  // Volle Spot-Daten zu den Markern. Sind sie da, sind die Marker IM VOLLBILD
  // antippbar und öffnen dasselbe Sheet wie auf Explore. Ohne sie bleibt die Karte
  // reine Anzeige. Ersetzt das frühere `enablePreview`-Flag: Nicht ein Schalter
  // entscheidet, ob etwas geht, sondern ob die Daten dafür da sind.
  spots?: SpotCardData[];
  loggedIn?: boolean;
  savedSlugs?: Set<string>;
  onSavedChange?: (slug: string, saved: boolean) => void;
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

  // Angetippter Spot -> volle Daten fürs Sheet. Marker allein reichen dafür nicht,
  // sie tragen nur, was gezeichnet wird.
  const selected = spots?.find((s) => s.slug === sel) ?? null;

  // Marker sind NUR im Vollbild antippbar. Die eingebettete Karte ist eine einzige
  // Schaltfläche (siehe SpotMap), dort kommt ohnehin kein Tap bei einem Marker an.
  const interactive = spots
    ? {
        onMarkerClick: (slug: string) => setSel(slug),
        selectedSlug: sel,
        onMapClick: () => setSel(null),
      }
    : {};

  // Beim Schliessen des Vollbilds darf kein Sheet zurückbleiben.
  function closeFullscreen() {
    setSel(null);
    setFullscreen(false);
  }

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
          openMapLabel={t("openMap")}
        />
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
              onClick={closeFullscreen}
              aria-label={t("elevation.close")}
              className="sg-hit absolute left-4 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-white/90 text-ink shadow-md ring-1 ring-black/5 backdrop-blur active:scale-95"
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

            {/* DASSELBE Sheet wie auf Explore, nicht ein zweites Kärtchen daneben.
                Vorher stand hier ein eigenes kleines Popup, das dieselbe Aufgabe mit
                eigener Optik löste. Wer von der Karte auf einen Spot tippt, soll überall
                dieselbe Antwort bekommen — Bild, Titel, Kurztext, Merken, weiter zum
                Spot. Möglich wurde das, weil SpotSheet nur noch SpotCardData verlangt. */}
            {selected && (
              <SpotSheet
                key={selected.slug}
                spot={selected}
                onClose={() => setSel(null)}
                loggedIn={loggedIn}
                saved={savedSlugs?.has(selected.slug) ?? false}
                onSavedChange={onSavedChange}
              />
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
