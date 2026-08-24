"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import BackButton from "@/components/BackButton";
import NavMap, { type NavStopPoint } from "./NavMap";
import ManeuverBanner from "./ManeuverBanner";
import NextStopBar from "./NextStopBar";
import ArrivalSheet from "./ArrivalSheet";
import { useGeolocationWatch } from "@/lib/use-geolocation-watch";
import { useWakeLock } from "@/lib/use-wake-lock";
import { useBikeNavigation } from "@/lib/use-bike-navigation";
import { useTourAudio, type PlayerStop } from "@/components/tours/useTourAudio";
import { estimateEtaMin } from "@/lib/nav-format";
import type { TourDetail } from "@/lib/tour-types";

const SAFETY_SEEN_KEY = "sg-bike-nav-safety-seen";

// Signierte Audio-URLs (getTourDetail, tour-audio-Bucket) laufen nach 2h ab. Eine lange
// Ausfahrt kann das überschreiten – 100 statt 120 Min als Sicherheitsabstand, damit die
// URL nicht GENAU in der Sekunde zwischen "noch gültig" und "schon 403" antippt wird.
const SIGNED_URL_REFRESH_MS = 100 * 60 * 1000;

// Der eigene Navigation-Screen der S-Bike-Runde (docs/40): permanente Turn-by-Turn-
// Führung zum jeweils nächsten Stopp, Ankunfts-Erkennung, danach der bestehende Audio-
// Guide. Bündelt GPS (use-geolocation-watch), den reinen Kern (bike-nav-core über
// use-bike-navigation) und die Karte (NavMap) zu EINEM Bildschirm – Priorität ist die
// Karte/Navigation, alles andere ist HUD-Chrome darüber.
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
  // Ziel-Marker für JEDE Station (NavMap.tsx) – "ein Zielpunkt für jede Navigation",
  // nicht nur die gerade angesteuerte.
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

  // Der Player zeigt normalerweise den zuletzt ANGEFAHRENEN Stopp – bei einer Ankunft
  // springt er automatisch dorthin, damit ArrivalSheet sofort den richtigen Track zeigt.
  const [activeAudioIndex, setActiveAudioIndex] = useState(0);
  useEffect(() => {
    // Über eine Microtask-Grenze -> kein synchrones setState im Effekt-Body (gleiches
    // Muster wie die gespeicherte Saison in Explore.tsx).
    if (bike.arrivedIndex == null) return;
    const i = bike.arrivedIndex;
    void Promise.resolve().then(() => setActiveAudioIndex(i));
  }, [bike.arrivedIndex]);

  // Eine lange Ausfahrt kann die 2h-Gültigkeit der signierten Audio-URLs überschreiten
  // (getTourDetail, tour-audio-Bucket) – vor einer SPÄTEN Ankunft einmal frische URLs
  // vom Server holen, statt an Stopp 8 in ein stilles 403 zu laufen. `router.refresh()`
  // holt den Server-Teil (die `tour`-Prop dieser Seite) neu; der ganze Client-Zustand
  // hier (GPS, Etappe, Fortschritt) bleibt unberührt, weil die Komponente dabei nicht
  // neu montiert wird.
  useEffect(() => {
    if (bike.arrivedIndex == null || mountedAtRef.current == null) return;
    if (Date.now() - mountedAtRef.current > SIGNED_URL_REFRESH_MS) router.refresh();
  }, [bike.arrivedIndex, router]);
  const audio = useTourAudio(playerStops, activeAudioIndex, setActiveAudioIndex);

  // Sicherheitshinweis einmal pro Gerät (StVO §102(3a): die Halterung macht die Nutzung
  // während der Fahrt erst zulässig). Start false, damit auch der ALLERERSTE Aufbau –
  // vor dem Lesen aus localStorage – lieber einmal zu oft hinweist als einmal zu wenig.
  const [safetySeen, setSafetySeen] = useState(false);
  useEffect(() => {
    // Über eine Microtask-Grenze -> kein synchrones setState im Effekt-Body (gleiches
    // Muster wie die gespeicherte Saison in Explore.tsx).
    void Promise.resolve().then(() => {
      try {
        setSafetySeen(localStorage.getItem(SAFETY_SEEN_KEY) === "1");
      } catch {
        setSafetySeen(true);
      }
    });
  }, []);
  const beginNavigation = () => {
    try {
      localStorage.setItem(SAFETY_SEEN_KEY, "1");
    } catch {
      /* privater Modus o.ä. – dann eben nächstes Mal wieder der Hinweis */
    }
    setSafetySeen(true);
    start(); // MUSS synchron im Klick-Handler bleiben (siehe use-geolocation-watch.ts)
  };

  // Das Start-Gate steht, bis GPS wirklich läuft: "idle" (noch nicht gestartet) sowie
  // die beiden Fehlzustände "denied"/"unavailable" (hier bleibt es sinnlos, die Runde
  // ohne Standort weiterzuzeigen). "signal-lost" dagegen ist ein FLÜCHTIGER Empfangs-
  // verlust NACH dem Start – da bleibt die HUD stehen und zeigt nur einen Hinweis,
  // statt den Nutzer zurück auf die Startfläche zu werfen.
  const showStartGate = gpsStatus === "idle" || gpsStatus === "denied" || gpsStatus === "unavailable";
  const currentStop = geoStops[bike.currentStopIndex] ?? null;
  const arrivedStop = bike.arrivedIndex != null ? (geoStops[bike.arrivedIndex] ?? null) : null;
  const maneuverStep =
    bike.leg && bike.nav.stepIndex >= 0 ? (bike.leg.steps[bike.nav.stepIndex] ?? null) : null;
  const etaMin =
    bike.status === "ready" ? estimateEtaMin(bike.nav.distanceToStopM, fix?.speedMps ?? null) : null;

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
    <div className="fixed inset-0 z-0">
      <NavMap
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

      {/* Start-Gate: watchPosition() BRAUCHT eine Nutzer-Geste (iOS Safari), die Karte
          startet deshalb nie von selbst. */}
      {showStartGate && (
        <div className="absolute inset-0 z-[50] flex flex-col items-center justify-end gap-4 bg-black/40 p-6 pb-[calc(env(safe-area-inset-bottom)+32px)] backdrop-blur-sm">
          {!safetySeen ? (
            <div className="w-full max-w-sm space-y-3 rounded-[22px] bg-cream p-5 text-center shadow-2xl">
              <p className="text-[15px] font-semibold text-ink">⚠️ {t("navSafetyHint")}</p>
              <button
                type="button"
                onClick={beginNavigation}
                className="w-full rounded-full bg-accent px-5 py-3 text-[15px] font-semibold text-white active:scale-[0.98]"
              >
                🧭 {t("startNavigation")}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={beginNavigation}
              className="w-full max-w-sm rounded-full bg-accent px-6 py-4 text-[16px] font-semibold text-white shadow-xl active:scale-[0.98]"
            >
              🧭 {t("startNavigation")}
            </button>
          )}
          {(gpsStatus === "denied" || gpsStatus === "unavailable") && (
            <p className="max-w-sm text-center text-[13px] text-white/90">
              {gpsStatus === "denied" ? t("navDenied") : t("navNoGps")}
            </p>
          )}
        </div>
      )}

      <ArrivalSheet
        open={bike.arrivedIndex != null}
        stop={arrivedStop}
        freeStops={tour.freeStops}
        totalStops={tour.stops.length}
        audio={audio}
        index={activeAudioIndex}
        total={playerStops.length}
        onContinue={bike.advance}
      />
    </div>
  );
}
