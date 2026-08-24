"use client";

import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import BackButton from "@/components/BackButton";
import GoogleNavMap from "./GoogleNavMap";
import GoogleArrivalPopup from "./GoogleArrivalPopup";
import ManeuverBanner from "@/components/tours/nav/ManeuverBanner";
import NextStopBar from "@/components/tours/nav/NextStopBar";
import { useGeolocationWatch } from "@/lib/use-geolocation-watch";
import { useWakeLock } from "@/lib/use-wake-lock";
import { useGoogleBikeNavigation } from "@/lib/use-google-bike-navigation";
import { estimateEtaMin } from "@/lib/nav-format";
import type { NavStopPoint } from "@/components/tours/nav/NavMap";
import type { TourDetail } from "@/lib/tour-types";

const GOOGLE_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";
const GOOGLE_MAP_ID = process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID;

// ═══ TESTHAKEN – NICHT DAUERHAFT ═══
// Google-Gegenstück zu BikeNavScreen.tsx (Mapbox), fürs Vergleichstest (siehe docs/40-Test-
// Auftrag). Bündelt dieselben Bausteine zu EINEM Bildschirm, nur die Karte + das
// Etappen-Routing kommen von Google statt von Mapbox – GPS (use-geolocation-watch), der reine
// Entscheidungs-Kern (bike-nav-core.ts über use-google-bike-navigation) und die
// Abbiege-/Distanz-Anzeige (ManeuverBanner, NextStopBar) sind UNVERÄNDERT dieselben Bausteine
// wie beim bestehenden S-Bike-Test – nur echt wiederverwendet, nicht zweimal gebaut.
//
// ANDERS als BikeNavScreen.tsx: Bei Ankunft öffnet sich kein eingebauter Player, sondern ein
// schlankes Popup (GoogleArrivalPopup), dessen Knopf in die NORMALE Audio-Guide-Seite
// (/touren/[slug]) führt – wie im Testauftrag verlangt.
export default function GoogleBikeNavScreen({ tour }: { tour: TourDetail }) {
  const t = useTranslations("Tours");
  const locale = useLocale();

  const geoStops = useMemo(() => tour.stops.filter((s) => s.lat != null && s.lng != null), [
    tour.stops,
  ]);
  const stopCoords = useMemo<[number, number][]>(
    () => geoStops.map((s) => [s.lng as number, s.lat as number]),
    [geoStops],
  );
  const navStopPoints = useMemo<NavStopPoint[]>(
    () => geoStops.map((s) => ({ lat: s.lat as number, lng: s.lng as number, order: s.order })),
    [geoStops],
  );

  const { fix, status: gpsStatus, start } = useGeolocationWatch();
  useWakeLock(gpsStatus === "requesting" || gpsStatus === "watching" || gpsStatus === "signal-lost");
  const bike = useGoogleBikeNavigation(stopCoords, fix, GOOGLE_API_KEY, locale);

  const showStartGate = gpsStatus === "idle" || gpsStatus === "denied" || gpsStatus === "unavailable";
  const currentStop = geoStops[bike.currentStopIndex] ?? null;
  const arrivedStop = bike.arrivedIndex != null ? (geoStops[bike.arrivedIndex] ?? null) : null;
  const maneuverStep =
    bike.leg && bike.nav.stepIndex >= 0 ? (bike.leg.steps[bike.nav.stepIndex] ?? null) : null;
  const etaMin =
    bike.status === "ready" ? estimateEtaMin(bike.nav.distanceToStopM, fix?.speedMps ?? null) : null;

  if (geoStops.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 bg-cream p-6 text-center">
        <p className="text-[15px] text-muted">{t("noAudio")}</p>
        <BackButton fallbackHref={`/touren/${tour.slug}`} label={tour.title} />
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-0">
      <GoogleNavMap
        apiKey={GOOGLE_API_KEY}
        mapId={GOOGLE_MAP_ID}
        route={bike.leg?.geometry ?? null}
        fix={fix ? { lng: fix.lng, lat: fix.lat } : null}
        bearingDeg={bike.nav.bearingDeg}
        stops={navStopPoints}
        activeIndex={bike.currentStopIndex}
        paddingBottom={arrivedStop ? 300 : 190}
        recenterLabel={t("navRecenter")}
      />

      <div className="pointer-events-none absolute inset-x-0 top-0 z-[46] flex items-start justify-between gap-2 px-3 pt-[calc(env(safe-area-inset-top)+10px)]">
        <div className="pointer-events-auto">
          <BackButton fallbackHref={`/touren/${tour.slug}`} label={tour.title} />
        </div>
        <span className="pointer-events-none rounded-full bg-white/85 px-3 py-1.5 text-[11px] font-semibold text-muted shadow-md backdrop-blur-md">
          🗺️ Google-Test
        </span>
      </div>

      {!showStartGate && maneuverStep && (
        <div className="pointer-events-none absolute inset-x-3 z-[45] top-[calc(env(safe-area-inset-top)+64px)]">
          <ManeuverBanner
            instruction={maneuverStep.instruction}
            distanceM={bike.nav.distanceToManeuverM}
            type={maneuverStep.type}
            modifier={maneuverStep.modifier}
          />
        </div>
      )}

      {!showStartGate && currentStop && (
        <div className="pointer-events-none absolute inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+16px)] z-[45] space-y-2">
          {bike.rerouting && (
            <p className="rounded-full bg-white/90 px-3 py-1.5 text-center text-[12px] font-semibold text-accent shadow backdrop-blur">
              {t("navRerouting")}
            </p>
          )}
          {!bike.rerouting && bike.status === "leg-error" && (
            <button
              type="button"
              onClick={bike.retry}
              className="pointer-events-auto w-full rounded-full bg-white/90 px-3 py-1.5 text-center text-[12px] font-semibold text-accent shadow backdrop-blur"
            >
              {t("navOffline")}
            </button>
          )}
          <NextStopBar
            stopEmoji={currentStop.emoji}
            stopTitle={currentStop.title}
            distanceM={bike.nav.distanceToStopM}
            etaMin={etaMin}
          />
        </div>
      )}

      {showStartGate && (
        <div className="absolute inset-0 z-[50] flex flex-col items-center justify-end gap-4 bg-black/40 p-6 pb-[calc(env(safe-area-inset-bottom)+32px)] backdrop-blur-sm">
          <div className="w-full max-w-sm space-y-3 rounded-[22px] bg-cream p-5 text-center shadow-2xl">
            <p className="text-[15px] font-semibold text-ink">⚠️ {t("navSafetyHint")}</p>
            <button
              type="button"
              onClick={start}
              className="w-full rounded-full bg-accent px-5 py-3 text-[15px] font-semibold text-white active:scale-[0.98]"
            >
              🧭 {t("startNavigation")}
            </button>
          </div>
          {(gpsStatus === "denied" || gpsStatus === "unavailable") && (
            <p className="max-w-sm text-center text-[13px] text-white/90">
              {gpsStatus === "denied" ? t("navDenied") : t("navNoGps")}
            </p>
          )}
          {!GOOGLE_API_KEY && (
            <p className="max-w-sm text-center text-[13px] text-white/90">
              NEXT_PUBLIC_GOOGLE_MAPS_API_KEY fehlt in .env.local.
            </p>
          )}
        </div>
      )}

      <GoogleArrivalPopup
        open={bike.arrivedIndex != null}
        stop={arrivedStop}
        tourSlug={tour.slug}
        freeStops={tour.freeStops}
        totalStops={tour.stops.length}
        onContinue={bike.advance}
      />
    </div>
  );
}
