"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { useRouter } from "@/i18n/navigation";
import BackButton from "@/components/BackButton";
import NavMap, { type NavStopPoint } from "./NavMap";
import ManeuverBanner from "./ManeuverBanner";
import NextStopBar from "./NextStopBar";
import ArrivalSheet from "./ArrivalSheet";
import SpotOffer from "./SpotOffer";
import { useGeolocationWatch } from "@/lib/use-geolocation-watch";
import { useWakeLock } from "@/lib/use-wake-lock";
import { useBikeNavigation } from "@/lib/use-bike-navigation";
import { useTourAudio, type PlayerStop } from "@/components/tours/useTourAudio";
import { estimateEtaMin } from "@/lib/nav-format";
import type { TourDetail } from "@/lib/tour-types";

// Signierte Audio-URLs (getTourDetail, tour-audio-Bucket) laufen nach 2h ab. Eine lange
// Ausfahrt kann das überschreiten – 100 statt 120 Min als Sicherheitsabstand, damit die
// URL nicht GENAU in der Sekunde zwischen "noch gültig" und "schon 403" angetippt wird.
const SIGNED_URL_REFRESH_MS = 100 * 60 * 1000;

// Der Fahrbildschirm des Rad-Audioguides (docs/40): permanente Abbiege-Führung über die
// GANZE Runde, ein Play-Angebot kurz vor jedem Spot, danach ein mitlaufender Player.
// Bündelt GPS (use-geolocation-watch), den reinen Kern (bike-nav-core über
// use-bike-navigation) und die Karte (NavMap) zu EINEM Bildschirm. Priorität ist die
// Karte, alles andere ist HUD darüber und darf sie nie ganz verdecken.
export default function BikeNavScreen({ tour }: { tour: TourDetail }) {
  const t = useTranslations("Tours");
  const locale = useLocale();
  const router = useRouter();
  // Erst im Effekt gesetzt (nicht direkt useRef(Date.now())): Date.now() während des
  // Renderns auszuwerten gilt als unreine Render-Funktion, auch wenn nur der ERSTE Wert
  // je verwendet wird.
  const mountedAtRef = useRef<number | null>(null);
  useEffect(() => {
    mountedAtRef.current = Date.now();
  }, []);

  // Nur Stopps mit Koordinaten können angefahren werden – dieselbe Filterung wie
  // TourView.tsx für Marker/Route, hier zusätzlich die Grundlage für den Player-Index.
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
  const playerStops: PlayerStop[] = useMemo(
    () =>
      geoStops.map((s) => ({
        order: s.order,
        title: s.title,
        audioUrl: s.audioUrl,
        locked: s.locked,
        durationSec: s.durationSec,
      })),
    [geoStops],
  );

  const { fix, status: gpsStatus, start } = useGeolocationWatch();
  useWakeLock(gpsStatus === "requesting" || gpsStatus === "watching" || gpsStatus === "signal-lost");
  const bike = useBikeNavigation(stopCoords, fix, locale);

  const [activeAudioIndex, setActiveAudioIndex] = useState(0);
  const audio = useTourAudio(playerStops, activeAudioIndex, setActiveAudioIndex);
  const [detailsOpen, setDetailsOpen] = useState(false);

  // Eine lange Ausfahrt kann die 2h-Gültigkeit der signierten Audio-URLs überschreiten:
  // vor einer SPÄTEN Wiedergabe einmal frische URLs vom Server holen, statt an Stopp 8 in
  // ein stilles 403 zu laufen. `router.refresh()` holt den Server-Teil neu; der
  // Client-Zustand (GPS, Route, Fortschritt) bleibt unberührt, weil die Komponente dabei
  // nicht neu montiert wird.
  const refreshedRef = useRef(false);
  useEffect(() => {
    if (bike.offeredSpotId == null || mountedAtRef.current == null) return;
    if (refreshedRef.current) return;
    if (Date.now() - mountedAtRef.current > SIGNED_URL_REFRESH_MS) {
      refreshedRef.current = true;
      router.refresh();
    }
  }, [bike.offeredSpotId, router]);

  const beginNavigation = () => {
    start(); // MUSS synchron im Klick-Handler bleiben (siehe use-geolocation-watch.ts)
  };

  // Play am Angebot: Der Player springt auf diesen Spot UND startet. Das ist die einzige
  // Stelle, an der Audio von selbst losläuft, und sie hängt an einem echten Fingertipp.
  const playOffered = useCallback(() => {
    const id = bike.offeredSpotId;
    if (id == null) return;
    if (activeAudioIndex !== id) {
      audio.go(id);
      // go() wechselt die Quelle; der Start gehört in denselben Tastendruck, sonst
      // verweigert iOS die Wiedergabe (kein Nutzergesten-Kontext mehr).
      audio.toggle();
      return;
    }
    audio.toggle();
  }, [bike.offeredSpotId, activeAudioIndex, audio]);

  const showStartGate = gpsStatus === "idle" || gpsStatus === "denied" || gpsStatus === "unavailable";

  const offeredStop = bike.offeredSpotId != null ? (geoStops[bike.offeredSpotId] ?? null) : null;
  const nextRouteSpot = bike.nav.nextSpotIndex >= 0 ? bike.spotIds[bike.nav.nextSpotIndex] : -1;
  const nextStop = nextRouteSpot >= 0 ? (geoStops[nextRouteSpot] ?? null) : null;

  const maneuverStep =
    bike.route && bike.nav.stepIndex >= 0 ? (bike.route.steps[bike.nav.stepIndex] ?? null) : null;
  const etaMin = bike.status === "ready" ? estimateEtaMin(bike.nav.remainingM, fix?.speedMps ?? null) : null;

  const totalM = bike.route?.distanceM ?? 0;
  const progress = totalM > 0 ? Math.min(1, Math.max(0, bike.nav.alongM / totalM)) : 0;

  const heardCount = bike.nav.spotPhase.filter((p) => p === "done").length;

  // Sollte praktisch nie vorkommen (das Publish-Gate verlangt mindestens einen
  // veröffentlichten Punkt), aber eine Runde ohne jede Koordinate darf die Navigation
  // nicht mit einem leeren, erklärungslosen Bildschirm beantworten.
  if (geoStops.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 bg-cream p-6 text-center">
        <p className="text-[15px] text-muted">{t("noAudio")}</p>
        <BackButton fallbackHref={`/touren/${tour.slug}`} label={tour.title} />
      </div>
    );
  }

  return (
    <div className="sg-nav fixed inset-0 z-0">
      <NavMap
        route={bike.route?.geometry ?? null}
        progress={progress}
        fix={fix ? { lng: fix.lng, lat: fix.lat } : null}
        bearingDeg={bike.nav.bearingDeg}
        stops={navStopPoints}
        activeIndex={nextRouteSpot >= 0 ? nextRouteSpot : geoStops.length - 1}
        paddingBottom={offeredStop ? 240 : 190}
        recenterLabel={t("navRecenter")}
      />

      <div className="pointer-events-none absolute inset-x-0 top-0 z-[46] flex items-start justify-between gap-2 px-3 pt-[calc(env(safe-area-inset-top)+10px)]">
        <div className="pointer-events-auto">
          <BackButton fallbackHref={`/touren/${tour.slug}`} label={tour.title} />
        </div>
      </div>

      {!showStartGate && !bike.finished && maneuverStep && (
        <div className="pointer-events-none absolute inset-x-3 z-[45] top-[calc(env(safe-area-inset-top)+64px)]">
          <ManeuverBanner
            instruction={maneuverStep.instruction}
            distanceM={bike.nav.distanceToManeuverM}
            type={maneuverStep.type}
            modifier={maneuverStep.modifier}
          />
        </div>
      )}

      {/* Unterer Stapel: Angebot/Player ÜBER der Zielleiste. Beide bleiben sichtbar, das
          Audio verdeckt die Führung nicht (Wunsch 6 in docs/40). */}
      {!showStartGate && !bike.finished && (
        <div className="pointer-events-none absolute inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+44px)] z-[45] space-y-2">
          {bike.rerouting && (
            <p className="sg-nav-card rounded-full px-3 py-1.5 text-center text-[12px] font-semibold text-accent">
              {t("navRerouting")}
            </p>
          )}
          {!bike.rerouting && bike.status === "error" && (
            <button
              type="button"
              onClick={bike.retry}
              className="sg-nav-card pointer-events-auto w-full rounded-full px-3 py-1.5 text-center text-[12px] font-semibold text-accent"
            >
              {t("navOffline")}
            </button>
          )}

          {offeredStop && (
            <SpotOffer
              stop={offeredStop}
              distanceM={bike.nav.distanceToNextSpotM}
              audio={audio}
              isCurrent={activeAudioIndex === bike.offeredSpotId}
              onPlay={playOffered}
              onDismiss={bike.dismissOffer}
              onOpenDetails={() => setDetailsOpen(true)}
            />
          )}

          {nextStop && (
            <NextStopBar
              stopEmoji={nextStop.emoji}
              stopTitle={nextStop.title}
              distanceM={bike.nav.remainingM}
              etaMin={etaMin}
            />
          )}
        </div>
      )}

      {/* Ende der Runde. Vorher lief der Zähler einfach weiter und der Gast blieb auf
          einem halb toten Bildschirm zurück: untere Leiste weg, alte Linie liegen
          geblieben, kein Weg heraus. */}
      {bike.finished && (
        <div className="absolute inset-0 z-[50] flex flex-col items-center justify-end bg-black/45 p-6 pb-[calc(env(safe-area-inset-bottom)+32px)] backdrop-blur-sm">
          <div className="sg-nav-card w-full max-w-sm space-y-3 rounded-[22px] p-6 text-center">
            <p className="text-[19px] font-bold text-ink">🎉 {t("navDoneTitle")}</p>
            <p className="text-[14px] leading-snug text-muted">
              {t("navDoneBody", { heard: heardCount, total: geoStops.length })}
            </p>
            <Link
              href={`/touren/${tour.slug}`}
              className="sg-nav-on-accent flex items-center justify-center rounded-full bg-accent px-5 py-3 text-[15px] font-semibold transition active:scale-[0.98]"
            >
              {t("navDoneBack")}
            </Link>
          </div>
        </div>
      )}

      {/* Start-Gate: watchPosition() BRAUCHT eine Nutzer-Geste (iOS Safari), die Karte
          startet deshalb nie von selbst. */}
      {showStartGate && (
        <div className="absolute inset-0 z-[50] flex flex-col items-center justify-end gap-4 bg-black/40 p-6 pb-[calc(env(safe-area-inset-bottom)+32px)] backdrop-blur-sm">
          {/* Der Hinweis steht IMMER da, nicht nur beim ersten Mal.
              Vorher hing das an einem localStorage-Merker, der erst nach dem ersten Bild
              gelesen wurde: Der Hinweis erschien, wurde einen Wimpernschlag später vom
              gelesenen Wert überstimmt und verschwand wieder. Das ist derselbe Fehler wie
              jeder aufblitzende Zustand, der aus dem Speicher nachgereicht wird.
              Ihn zu behalten kostet nichts: Der Knopf darunter ist in beiden Fällen
              derselbe, es war nie ein zusätzlicher Tipp, nur ein zusätzlicher Satz. Und
              bei einer StVO-Sache ist "jedes Mal" ohnehin die richtige Antwort. */}
          <div className="sg-nav-card w-full max-w-sm space-y-3 rounded-[22px] p-5 text-center">
            <p className="text-[15px] font-semibold text-ink">⚠️ {t("navSafetyHint")}</p>
            <button
              type="button"
              onClick={beginNavigation}
              className="sg-nav-on-accent w-full rounded-full bg-accent px-5 py-3 text-[15px] font-semibold active:scale-[0.98]"
            >
              🧭 {t("startNavigation")}
            </button>
          </div>
          {(gpsStatus === "denied" || gpsStatus === "unavailable") && (
            <p className="max-w-sm text-center text-[13px] text-white/90">
              {gpsStatus === "denied" ? t("navDenied") : t("navNoGps")}
            </p>
          )}
        </div>
      )}

      {/* Das ausführliche Sheet gibt es weiterhin, aber NUR auf Tippen (Titel im
          Angebots-Streifen). Es springt nicht mehr von selbst auf. */}
      <ArrivalSheet
        open={detailsOpen && offeredStop != null}
        stop={offeredStop}
        freeStops={tour.freeStops}
        totalStops={tour.stops.length}
        audio={audio}
        index={activeAudioIndex}
        total={playerStops.length}
        onContinue={() => setDetailsOpen(false)}
      />
    </div>
  );
}
