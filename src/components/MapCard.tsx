"use client";

import { useEffect, useState } from "react";

// Freier Streifen oben im Vollbild: Safe-Area kommt per CSS dazu, hier zählt nur, was
// die schwebenden Knöpfe (Schliessen, Titel-Pille) belegen.
const FULLSCREEN_PAD_TOP = 96;
// Sichtbarer Rand zwischen eingepasster Route und dem Sheet, wie auf der Startseite.
const FULLSCREEN_GAP = 24;
// Platz für die schwebende Desktop-Karte, dieselbe Zahl wie auf der Startseite.
const DESKTOP_CARD_PAD = 470;
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import SpotMap, { type MapMarker } from "./SpotMap";
import SpotSheet, { SPOT_SHEET_PEEK } from "./SpotSheet";
import SpotCardDesktop from "./SpotCardDesktop";
import { useSpotSelection, type SelectableSpot } from "./useSpotSelection";
import { useViewportHeight } from "@/lib/viewport";
import { useIsDesktop } from "@/lib/use-is-desktop";
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
  // antippbar, öffnen dasselbe Sheet wie auf Explore und zeigen bei Wanderungen den
  // Weg. Ohne sie bleibt die Karte reine Anzeige. Ersetzt das frühere
  // `enablePreview`-Flag: Nicht ein Schalter entscheidet, ob etwas geht, sondern ob
  // die Daten dafür da sind.
  spots?: SelectableSpot[];
  loggedIn?: boolean;
  savedSlugs?: Set<string>;
  onSavedChange?: (slug: string, saved: boolean) => void;
}) {
  const t = useTranslations("Detail");
  const [fullscreen, setFullscreen] = useState(false);
  const mounted = useIsMounted();
  const vh = useViewportHeight();
  const isDesktop = useIsDesktop();

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

  // DERSELBE HAKEN WIE AUF DER STARTSEITE.
  // Auswahl, Wanderroute, Kamerafahrt und das Zusammenspiel mit dem Sheet kommen aus
  // useSpotSelection — nicht nachgebaut, sondern dieselbe Quelle. Wer die Startseiten-
  // Karte verbessert, verbessert diese hier mit. Der Unterschied zwischen den beiden
  // bleibt genau da, wo er hingehört: Diese Karte ist im Grundzustand eine kleine
  // Vorschau, und ihre Ränder unten/oben sind andere (siehe focusFor weiter unten).
  const {
    spot: selected,
    open,
    close: clearSelection,
    route,
    selectedSlug,
    focusFor,
    closing,
    setDismissing,
  } = useSpotSelection(spots ?? []);

  // Marker sind NUR im Vollbild antippbar. Die eingebettete Karte ist eine einzige
  // Schaltfläche (siehe SpotMap), dort kommt ohnehin kein Tap bei einem Marker an.
  const interactive = spots
    ? { onMarkerClick: open, selectedSlug, onMapClick: clearSelection }
    : {};

  // Ränder für die Kamerafahrt im Vollbild: oben die Safe-Area plus die schwebenden
  // Knöpfe, unten der Anteil, den das Spot-Sheet abdeckt — dieselbe Rechnung wie auf
  // der Startseite, nur ohne Header und Tab-Leiste.
  // Unten bleibt frei, was den Spot verdecken würde: am Handy der Anteil des
  // Peek-Sheets, am Desktop die schwebende Karte. Dieselben Zahlen wie auf der
  // Startseite, damit sich die Kamerafahrt auf beiden Seiten gleich anfühlt.
  const focus = focusFor(
    FULLSCREEN_PAD_TOP,
    isDesktop
      ? DESKTOP_CARD_PAD
      : Math.round((vh || 800) * SPOT_SHEET_PEEK) + FULLSCREEN_GAP,
  );

  // Beim Schliessen des Vollbilds darf kein Sheet zurückbleiben.
  function closeFullscreen() {
    clearSelection();
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
              // Die Wanderwege, die es auf der Startseite immer schon gab. Ohne sie war
              // eine gemerkte Wanderung hier nur ein Punkt.
              route={route}
              focus={focus}
              showRouteEnds={false}
              fitRoute={false}
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
            {/* Handy = ziehbares Bottom-Sheet, Desktop = schwebende Karte. Exakt die
                Aufteilung der Startseite: Ein Sheet, das man am Mauszeiger hochzieht,
                wäre am Desktop eine Geste, die es dort nicht gibt.
                `isDesktop` darf hier an JavaScript hängen (anders als beim Grundlayout),
                weil dieses Panel erst existiert, nachdem jemand einen Marker angetippt
                hat — die Hydration ist da längst durch, es blitzt nichts auf. */}
            {selected &&
              (isDesktop ? (
                <SpotCardDesktop
                  spot={selected}
                  // Kein Versatz: Diese Karte liegt vollflächig, ohne Spot-Leiste links.
                  panelOffset={false}
                  onClose={clearSelection}
                  loggedIn={loggedIn}
                  saved={savedSlugs?.has(selected.slug) ?? false}
                  onSavedChange={onSavedChange}
                />
              ) : (
                <SpotSheet
                  key={selected.slug}
                  spot={selected}
                  closing={closing}
                  onDismissStart={() => setDismissing(true)}
                  onClose={clearSelection}
                  loggedIn={loggedIn}
                  saved={savedSlugs?.has(selected.slug) ?? false}
                  onSavedChange={onSavedChange}
                />
              ))}
          </div>,
          document.body,
        )}
    </>
  );
}
