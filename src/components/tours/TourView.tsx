"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import SpotMap, { type MapMarker } from "@/components/SpotMap";
import MobileSheet from "@/components/MobileSheet";
import BackButton from "@/components/BackButton";
import ActionTile from "@/components/ActionTile";
import { buildMapsLink } from "@/lib/maps";
import { useTourAudio, type PlayerStop } from "./useTourAudio";
import AudioTransport from "./AudioTransport";
import TranscriptView from "./TranscriptView";
import type { TourDetail } from "@/lib/tour-types";

// Peek-Anteil des Sheets (Anteil der Viewport-Höhe). Muss zum Karten-Padding passen,
// damit Pins nie hinter dem Sheet verschwinden.
const PEEK = 0.34;
const SHEET_DETENTS = [PEEK, 0.62, 0.94];

export default function TourView({
  tour,
  onRestart,
  topRight,
}: {
  tour: TourDetail;
  onRestart?: () => void;
  topRight?: React.ReactNode;
}) {
  const t = useTranslations("Tours");
  const [active, setActive] = useState(0);
  const [focused, setFocused] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  const [vh, setVh] = useState(0);

  // Desktop/Mobile + Viewport-Höhe (fürs Karten-Padding) messen.
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const u = () => {
      setIsDesktop(mq.matches);
      setVh(window.innerHeight);
    };
    u();
    mq.addEventListener("change", u);
    window.addEventListener("resize", u);
    return () => {
      mq.removeEventListener("change", u);
      window.removeEventListener("resize", u);
    };
  }, []);

  const selectStop = (i: number) => {
    setActive(i);
    setFocused(true); // ab jetzt fliegt die Karte zum Stopp (initial: ganze Runde im Blick)
  };

  const playerStops: PlayerStop[] = tour.stops.map((s) => ({
    order: s.order,
    title: s.title,
    audioUrl: s.audioUrl,
    locked: s.locked,
    durationSec: s.durationSec,
  }));
  const audio = useTourAudio(playerStops, active, selectStop);

  // ── Karte: nummerierte Pins + echte Route (KI-Runde) + Startpunkt ──
  const geoStops = tour.stops.filter((s) => s.lat != null && s.lng != null);
  const stopMarkers: MapMarker[] = geoStops.map((s) => ({
    slug: s.spotSlug,
    lat: s.lat as number,
    lng: s.lng as number,
    emoji: String(s.order),
    title: s.title,
    locked: false,
  }));
  const startMarker: MapMarker | null =
    tour.start && tour.start.lat != null && tour.start.lng != null
      ? { slug: "__start__", lat: tour.start.lat, lng: tour.start.lng, emoji: "🚩", title: t("start") }
      : null;
  const markers: MapMarker[] = startMarker ? [startMarker, ...stopMarkers] : stopMarkers;
  const route: [number, number][] | null =
    tour.routeGeo && tour.routeGeo.length > 1
      ? tour.routeGeo
      : stopMarkers.length > 1
        ? stopMarkers.map((m) => [m.lng, m.lat])
        : null;
  const center: [number, number] = startMarker
    ? [startMarker.lng, startMarker.lat]
    : stopMarkers.length
      ? [stopMarkers[0].lng, stopMarkers[0].lat]
      : [13.05, 47.6];

  const activeStop = tour.stops[active];

  // Ziel für „Zum Startpunkt": fixer Gebiets-Start (KI/gespeichert) oder – Fallback für
  // kuratierte Runden – der erste Stopp mit Koordinaten.
  const startPoint =
    tour.start && tour.start.lat != null && tour.start.lng != null
      ? { lat: tour.start.lat, lng: tour.start.lng }
      : geoStops.length
        ? { lat: geoStops[0].lat as number, lng: geoStops[0].lng as number }
        : null;

  // Karten-Padding: Pins bleiben über dem Sheet (mobil) bzw. neben dem Panel (Desktop).
  const sheetPad = isDesktop ? 40 : Math.round((vh || 800) * PEEK) + 32;
  const mapPadding = isDesktop
    ? { top: 80, right: 80, left: 80, bottom: 80 }
    : { top: 96, right: 40, left: 40, bottom: sheetPad };
  const focus =
    focused && activeStop?.lat != null && activeStop?.lng != null
      ? { lng: activeStop.lng as number, lat: activeStop.lat as number, padTop: 96, padBottom: sheetPad }
      : null;

  // Inhaltslage des aktiven Stopps: Audio + Text laufen ZUSAMMEN (Mitlesen), kein Umschalten.
  const hasAudio = !!activeStop?.audioUrl;
  const hasText = !!activeStop?.audioText;
  const locked = !!activeStop?.locked;
  const canPlay = hasAudio && !locked;

  // ── Kopf-Chrome (Zurück/Andere-Runde + Speichern) — schwebt über der Karte ──
  const backControl = onRestart ? (
    <button
      type="button"
      onClick={onRestart}
      className="inline-flex items-center gap-1 rounded-full bg-white/85 px-3.5 py-2 text-[14px] font-semibold text-ink shadow-md backdrop-blur-md transition active:scale-95"
    >
      ↺ {t("rebuild")}
    </button>
  ) : (
    <BackButton fallbackHref="/touren" label={t("backToList")} />
  );

  // ── Panel-Inhalt (identisch in Sheet [mobil] und Aside [Desktop]) ──
  const panel = (
    <div className="px-5">
      {/* Now Playing – Trennung nur über Weißraum (keine Hairline, die am Peek-Rand
          durchblitzt), iOS-2026-minimalistisch. */}
      <div className="pb-2">
        {/* Foto bleibt auch bei gesperrten Stopps sichtbar: Titel/Bild/Position sind
            bei Touren öffentliche Teaser, nur das Audio ist Pro (Migration 0029). */}
        {activeStop?.imageUrl && (
          <div className="relative mb-3 aspect-[16/10] overflow-hidden rounded-[16px] bg-black/5 shadow-sm">
            <Image
              src={activeStop.imageUrl}
              alt=""
              fill
              sizes="(min-width: 768px) 27rem, 100vw"
              className="object-cover"
            />
          </div>
        )}
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
          {t("stopOf", { current: active + 1, total: tour.stops.length })}
        </p>
        <h2 className="truncate text-[18px] font-bold leading-tight text-ink">
          {activeStop?.title}
        </h2>
        {canPlay && (
          <div className="mt-4">
            <AudioTransport
              audio={audio}
              index={active}
              total={tour.stops.length}
              canPlay={canPlay}
            />
          </div>
        )}
      </div>

      {/* Inhalt: Transkript zum Mitlesen (immer sichtbar, wenn vorhanden) */}
      {locked ? (
        <div className="mt-6 rounded-[16px] bg-white/70 p-5 text-center">
          <div className="text-3xl" aria-hidden>
            🔒
          </div>
          <p className="mt-2 text-[15px] font-semibold text-ink">{t("lockedTitle")}</p>
          <p className="mt-1 text-[13px] leading-relaxed text-muted">{t("lockedBody")}</p>
          <Link
            href="/pro"
            className="mt-3 inline-block rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-white active:scale-[0.98]"
          >
            {t("unlock")}
          </Link>
        </div>
      ) : !hasAudio && !hasText ? (
        <p className="mt-6 rounded-[16px] bg-white/70 p-4 text-center text-[13px] text-muted">
          {t("noAudio")}
        </p>
      ) : hasText ? (
        <div className="mt-6">
          <TranscriptView text={activeStop?.audioText ?? ""} />
        </div>
      ) : (
        activeStop?.shortDesc && (
          <p className="mt-6 rounded-[16px] bg-white/60 p-4 text-[14px] leading-relaxed text-muted">
            {activeStop.shortDesc}
          </p>
        )
      )}

      {/* Alle Stopps */}
      <div className="mt-8">
        <p className="mb-3 px-1 text-[12px] font-semibold uppercase tracking-wide text-muted">
          {t("allStops")}
        </p>
        <ol className="space-y-3">
          {tour.stops.map((s, i) => {
            const on = i === active;
            return (
              <li key={`${s.spotSlug}-${i}`}>
                <button
                  type="button"
                  onClick={() => selectStop(i)}
                  className={`flex w-full items-center gap-3 rounded-[14px] bg-white/80 px-3.5 py-3.5 text-left shadow-sm ring-1 transition ${
                    on ? "ring-2 ring-accent" : "ring-black/[0.04]"
                  }`}
                >
                  {s.imageUrl ? (
                    <span className="relative h-11 w-11 shrink-0 overflow-hidden rounded-[12px] bg-black/5">
                      <Image src={s.imageUrl} alt="" fill sizes="44px" className="object-cover" />
                      <span className="absolute left-0.5 top-0.5 flex h-[17px] min-w-[17px] items-center justify-center rounded-full bg-black/55 px-1 text-[10px] font-bold text-white">
                        {s.order}
                      </span>
                    </span>
                  ) : (
                    <span
                      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] text-[14px] font-bold ${
                        on ? "bg-accent text-white" : "bg-accent/10 text-accent"
                      }`}
                    >
                      {s.order}
                    </span>
                  )}
                  <span className="min-w-0 flex-1 truncate text-[15px] font-semibold text-ink">
                    {s.title}
                  </span>
                  {s.locked ? (
                    <span className="shrink-0 text-[15px]" aria-hidden>
                      🔒
                    </span>
                  ) : on && audio.playing ? (
                    <span className="shrink-0 text-[11px] font-semibold text-accent">
                      {t("playingNow")}
                    </span>
                  ) : (
                    <span className="shrink-0 text-[12px] text-muted" aria-hidden>
                      ›
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ol>
      </div>

      {/* Zum Startpunkt: Navigation per Auto / Öffis (Google Maps) */}
      {startPoint && (
        <div className="mt-8">
          <p className="mb-3 px-1 text-[12px] font-semibold uppercase tracking-wide text-muted">
            {t("toStart")}
          </p>
          <div className="grid gap-2.5 sm:grid-cols-2">
            <ActionTile
              href={buildMapsLink(startPoint.lat, startPoint.lng, "driving")}
              icon="🚗"
              label={t("byCar")}
              sub={t("mapsSub")}
            />
            <ActionTile
              href={buildMapsLink(startPoint.lat, startPoint.lng, "transit")}
              icon="🚌"
              label={t("byTransit")}
              sub={t("mapsSub")}
            />
          </div>
        </div>
      )}

      {/* Voll-Sperre-Hinweis bei komplett gegateter Tour */}
      {tour.isPro && !tour.canSeePro && (
        <div className="mt-8 flex flex-col items-start gap-3 rounded-[16px] bg-white/70 p-5">
          <p className="text-[14px] leading-relaxed text-muted">{t("lockedBody")}</p>
          <Link
            href="/pro"
            className="rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-white active:scale-[0.98]"
          >
            {t("unlock")}
          </Link>
        </div>
      )}
    </div>
  );

  return (
    <div className="fixed inset-0 z-0 md:top-14">
      {/* Fullscreen-Karte: mobil vollflächig, Desktop um das Panel versetzt */}
      <div className="absolute inset-0 md:left-[var(--sg-panel)]">
        {markers.length > 0 ? (
          <SpotMap
            markers={markers}
            route={route}
            showRouteEnds={false}
            fitRoute={true}
            selectedSlug={activeStop?.spotSlug}
            focus={focus}
            center={center}
            zoom={14}
            padding={mapPadding}
            mapClass={topRight ? "sg-ctrl-tour" : "sg-ctrl-safe"}
            onMarkerClick={(slug) => {
              if (slug === "__start__") return;
              const i = tour.stops.findIndex((st) => st.spotSlug === slug);
              if (i >= 0) selectStop(i);
            }}
          />
        ) : (
          <div className="h-full w-full bg-cream" />
        )}
      </div>

      {/* Kopf-Chrome schwebt über der Karte (nur mobil; Desktop im Panel-Kopf) */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-[46] flex items-start justify-between gap-2 px-3 pt-[calc(env(safe-area-inset-top)+10px)] md:hidden">
        <div className="pointer-events-auto">{backControl}</div>
        <div className="pointer-events-auto">{topRight}</div>
      </div>

      {isDesktop ? (
        <aside className="absolute inset-y-0 left-0 z-10 flex w-[var(--sg-panel)] flex-col border-r border-black/5 bg-cream/95 backdrop-blur-xl">
          <div className="flex items-center justify-between gap-2 px-4 pt-4">
            {backControl}
            {topRight}
          </div>
          <div className="flex-1 overflow-y-auto pb-16 pt-6">{panel}</div>
        </aside>
      ) : (
        <MobileSheet hide={false} detents={SHEET_DETENTS}>
          {panel}
        </MobileSheet>
      )}
    </div>
  );
}
