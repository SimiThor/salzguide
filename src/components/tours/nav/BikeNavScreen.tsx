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
import StopListSheet from "./StopListSheet";
import SpotOffer from "./SpotOffer";
import { useGeolocationWatch } from "@/lib/use-geolocation-watch";
import { useWakeLock } from "@/lib/use-wake-lock";
import { useBikeNavigation } from "@/lib/use-bike-navigation";
import { atSpot } from "@/lib/bike-nav-core";
import { readRide, writeRide, clearRide, type SavedRide } from "@/lib/bike-nav-memory";
import { useTourAudio, type PlayerStop } from "@/components/tours/useTourAudio";
import { estimateEtaMin } from "@/lib/nav-format";
import { sliceAlong, haversineMeters } from "@/lib/geo";
import type { TourDetail, TourStopView } from "@/lib/tour-types";

// Signierte Audio-URLs (getTourDetail, tour-audio-Bucket) laufen nach 2h ab. Eine lange
// Ausfahrt kann das überschreiten – 100 statt 120 Min als Sicherheitsabstand, damit die
// URL nicht GENAU in der Sekunde zwischen "noch gültig" und "schon 403" angetippt wird.
const SIGNED_URL_REFRESH_MS = 100 * 60 * 1000;

// Nummer des ersten offenen Halts, fuer den Knopf "Weiterfahren, Halt n von total".
function firstOpenOrder(stops: TourStopView[], done: number[]): number {
  const i = stops.findIndex((_, idx) => !done.includes(idx));
  return i >= 0 ? stops[i].order : 1;
}

// Der Fahrbildschirm des Rad-Audioguides (docs/40): permanente Abbiege-Führung über die
// GANZE Runde, ein Play-Angebot kurz vor jedem Spot, danach ein mitlaufender Player.
// Bündelt GPS (use-geolocation-watch), den reinen Kern (bike-nav-core über
// use-bike-navigation) und die Karte (NavMap) zu EINEM Bildschirm. Priorität ist die
// Karte, alles andere ist HUD darüber und darf sie nie ganz verdecken.
export default function BikeNavScreen({
  tour,
  proPrice = "",
}: {
  tour: TourDetail;
  /**
   * Preis aus Stripe, serverseitig geholt. Gesetzt heisst: Der Kauf passiert im Sheet und
   * fuehrt danach hierher zurueck. Leer heisst: Stripe war nicht erreichbar, dann bleibt der
   * alte Weg ueber /pro. Ein Kaufblock OHNE Preis waere keine Option, § 8 Abs. 1 FAGG
   * verlangt ihn unmittelbar vor der Vertragserklaerung.
   */
  proPrice?: string;
}) {
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
        // Gesperrter Stopp = die Kostprobe. Der Server hat schon entschieden, welche der
        // beiden Dateien er signiert; hier wird nur noch genommen, was da ist.
        audioUrl: s.audioUrl ?? s.teaserUrl ?? null,
        locked: s.locked,
        durationSec: s.durationSec ?? s.teaserSec ?? null,
      })),
    [geoStops],
  );

  // Ziel der Runde (Migration 0061). Bei einer Rundtour ist es der Startpunkt, und ohne
  // ihn hoerte die Navigation am LETZTEN SPOT auf: Bei Runde A ist das Muelln, 692 m vom
  // Leihrad entfernt. Der Gast bekaeme "Ziel erreicht", waehrend sein Rad noch sieben
  // Minuten weiter steht. Ist kein Ziel gesetzt, bleibt es wie bisher.
  const endCoord = useMemo<[number, number] | null>(
    () => (tour.end ? [tour.end.lng, tour.end.lat] : null),
    [tour.end],
  );

  // Gedaechtnis der Runde (bike-nav-memory.ts): im EFFEKT gelesen, nie beim Rendern. Ein
  // gespeicherter Wert, der erst nach dem ersten Bild nachkommt, liesse den Startknopf
  // umspringen; deshalb zeigt das Gate seine Knoepfe erst, wenn hier etwas anderes als
  // "loading" steht. Genau an diesem Umspringen ist der fruehere localStorage-Merker fuer
  // den Sicherheitshinweis gescheitert (siehe Kommentar am Gate).
  const [memory, setMemory] = useState<"loading" | SavedRide | null>("loading");
  useEffect(() => {
    const saved = readRide(tour.slug);
    void Promise.resolve().then(() => setMemory(saved));
  }, [tour.slug]);
  // Was der Gast am Gate entschieden hat: weiterfahren (erledigte Halte aus dem Speicher)
  // oder von vorn. Der Hook liest es beim ersten Fix, danach nie wieder.
  const [resumeDone, setResumeDone] = useState<ReadonlySet<number> | null>(null);

  const { fix, status: gpsStatus, start } = useGeolocationWatch();
  useWakeLock(gpsStatus === "requesting" || gpsStatus === "watching" || gpsStatus === "signal-lost");
  const bike = useBikeNavigation(stopCoords, fix, locale, endCoord, resumeDone);

  const [activeAudioIndex, setActiveAudioIndex] = useState(0);
  const audio = useTourAudio(playerStops, activeAudioIndex, setActiveAudioIndex);
  const [detailsOpen, setDetailsOpen] = useState(false);

  // Was WIRKLICH gehört wurde, getrennt mitgeschrieben. Der Kern kennt den Player bewusst
  // nicht, und seine Phase "done" heisst nur "vorbeigefahren, gehört oder nicht". Der
  // Abschluss zählte bisher diese Phasen und behauptete damit Gehörtes, das nie lief.
  // Schlimmer: Bei einer Neuberechnung fallen die erledigten Spots aus der Liste, der
  // Zähler fiel danach auf null. Diese Menge hängt an den Tour-Indizes und übersteht das.
  //
  // An der playing-Flanke eingetragen, nicht am Indexwechsel: useTourAudio schaltet beim
  // Ende einer Geschichte selbst auf den nächsten Stopp weiter, der wäre sonst mitgezählt.
  const [heard, setHeard] = useState<Set<number>>(() => new Set());
  useEffect(() => {
    if (!audio.playing) return;
    // Über eine Microtask-Grenze, kein synchrones setState im Effekt-Body (dasselbe
    // Muster wie die gespeicherte Saison in Explore.tsx).
    void Promise.resolve().then(() => {
      setHeard((prev) => (prev.has(activeAudioIndex) ? prev : new Set(prev).add(activeAudioIndex)));
    });
  }, [audio.playing, activeAudioIndex]);

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

  // Wiedereinstieg: nur, wenn etwas erledigt ist UND noch etwas offen. Eine ganz
  // abgehakte, aber nie zu Ende gefahrene Runde faengt still von vorn an. In EINEM useMemo,
  // weil der React-Compiler die Datei sonst nicht mehr durchliess (preserve-manual-
  // memoization an einer ganz anderen Stelle; per Ausschlussverfahren am 15.09.2026 auf
  // den Lesezugriff `resumable.done` im Render eingegrenzt).
  const { resumable, resumeOrder } = useMemo(() => {
    const ride =
      memory !== "loading" &&
      memory != null &&
      memory.done.length > 0 &&
      memory.done.length < geoStops.length
        ? memory
        : null;
    return { resumable: ride, resumeOrder: ride ? firstOpenOrder(geoStops, ride.done) : 1 };
  }, [memory, geoStops]);
  const resumeRide = () => {
    if (resumable) {
      setResumeDone(new Set(resumable.done));
      setHeard(new Set(resumable.heard));
    }
    start(); // synchron in der Geste, wie beginNavigation
  };
  const restartRide = () => {
    clearRide(tour.slug);
    setResumeDone(null);
    start();
  };

  const showStartGate = gpsStatus === "idle" || gpsStatus === "denied" || gpsStatus === "unavailable";

  // Welcher Spot steht im Streifen? Normalerweise der angebotene. Läuft aber gerade eine
  // Geschichte, gewinnt DIESE, auch wenn ihr Spot schon hinter uns liegt.
  //
  // Vorher verschwand der Streifen 100 m nach dem Spot (dort verbucht der Kern ihn als
  // passiert), während das Audio weiterlief: Die Geschichte erzählte weiter, und es gab im
  // ganzen Bildschirm keinen Pause-Knopf mehr. Eine dreiminütige Geschichte überlebt bei
  // 18 km/h locker die 100 m, das war also der Normalfall und kein Randfall.
  // Von Hand gewaehlter Stopp: Tipp auf einen Pin oder auf einen Eintrag in der Stoppliste.
  //
  // WARUM ES DEN GEBEN MUSS: Das automatische Angebot haengt an der Ortung. Steht der Gast
  // in einer Haeuserschlucht, liegt sie in der Altstadt gemessen 11 bis 13 m daneben, und
  // an einer Ampel kann sie ganz wegbleiben. Ohne einen Weg von Hand waere die Geschichte
  // dann einfach nicht zu hoeren, obwohl der Gast direkt davor steht.
  //
  // Er hat VORRANG vor dem automatischen Angebot: Wer selbst tippt, hat gerade eine
  // Absicht, und die darf ein Vorschlag nicht ueberschreiben.
  const [manualSpotId, setManualSpotId] = useState<number | null>(null);
  const [stopsOpen, setStopsOpen] = useState(false);
  // Welchen Spot hat der Gast per X ausdruecklich weggeschickt?
  //
  // Ohne diesen Merker liess sich der Streifen im Grunde nicht schliessen: Er zeigt eine
  // angefangene Geschichte auch im PAUSIERTEN Zustand weiter (audio.time > 0), damit man
  // sie wieder aufnehmen kann. Genau diese Regel holte ihn nach jedem X sofort zurueck.
  // Das X ist aber eine Ansage, und die schlaegt die Regel.
  const [closedSpotId, setClosedSpotId] = useState<number | null>(null);

  // Eine angefangene Geschichte haelt den Streifen offen, auch pausiert. Weggeschickt
  // wurde sie aber, wenn ihr Spot in closedSpotId steht.
  const laufenderSpot =
    (audio.playing || audio.time > 0) && activeAudioIndex !== closedSpotId
      ? activeAudioIndex
      : null;

  // Der zuletzt angebotene Halt bleibt stehen, bis etwas Neues passiert.
  //
  // Vorher verschwand der Streifen von selbst, sobald der Kern den Halt als passiert
  // verbuchte. Wer an der Ampel stand und den Play-Knopf schon weg fand, hatte den Halt
  // verloren und wusste nicht warum. Apples Accessibility-Kapitel verbietet zeitgesteuert
  // verschwindende Bedienelemente ausdruecklich.
  //
  // Er geht weg durch: Play, das X, oder wenn der naechste Halt den Streifen uebernimmt.
  const [letzterAngebot, setLetzterAngebot] = useState<number | null>(null);
  useEffect(() => {
    if (bike.offeredSpotId == null) return;
    // Ueber eine Microtask-Grenze, kein synchrones setState im Effekt-Body (dasselbe
    // Muster wie `heard` weiter oben und die gespeicherte Saison in Explore.tsx).
    const id = bike.offeredSpotId;
    void Promise.resolve().then(() => setLetzterAngebot(id));
  }, [bike.offeredSpotId]);
  const haengengeblieben =
    letzterAngebot != null && letzterAngebot !== closedSpotId ? letzterAngebot : null;

  const shownSpotId = manualSpotId ?? bike.offeredSpotId ?? laufenderSpot ?? haengengeblieben;
  const offeredStop = shownSpotId != null ? (geoStops[shownSpotId] ?? null) : null;

  // Play am Angebot. Steht der Player schon auf diesem Spot, ist es ein einfaches
  // Umschalten; sonst muss die Quelle im SELBEN Tastendruck mitwechseln (audio.playAt).
  //
  // Hier stand vorher go() gefolgt von toggle(). go() ist aber nur ein React-Zustands-
  // wechsel, der erst im naechsten Render greift: toggle() sprach damit noch die ALTE
  // Datei an, kurz lief die vorige Geschichte los, dann pausierte der Quellen-Effekt sie
  // weg. Es blieb still, und der Gast haette ein zweites Mal tippen muessen -- bei
  // 18 km/h ist der Spot dann vorbei. Nur der allererste Spot funktionierte.
  // Tipp auf einen Pin: den Streifen fuer DIESEN Stopp zeigen, mehr nicht. Bewusst kein
  // Autostart. Am Lenker soll nichts von selbst losreden, und docs/40 haelt das als Regel
  // fest: Der Play-Knopf kommt, gedrueckt wird er vom Menschen.
  const pickStop = useCallback(
    (i: number) => {
      // Auf einen ANDEREN Spot tippen haelt die laufende Geschichte an. Zwei Stimmen
      // gleichzeitig gibt es nicht, und weiterlaufen zu lassen, waehrend im Streifen schon
      // etwas anderes steht, ist der verwirrendste der drei moeglichen Ausgaenge.
      // Auf denselben Spot tippen aendert nichts, der steht ja schon da.
      if (i !== activeAudioIndex) audio.pause();
      setManualSpotId(i);
      setClosedSpotId(null);
      setStopsOpen(false);
    },
    [activeAudioIndex, audio],
  );

  // Das X: anhalten, wegraeumen, und diesen Spot nicht von selbst zurueckholen.
  const dismissShown = useCallback(() => {
    audio.pause();
    setClosedSpotId(shownSpotId);
    setManualSpotId(null);
    setLetzterAngebot(null);
    bike.dismissOffer();
  }, [audio, shownSpotId, bike]);

  const playOffered = useCallback(() => {
    const id = shownSpotId;
    if (id == null) return;
    setClosedSpotId(null); // wer startet, will den Streifen sehen
    if (activeAudioIndex !== id) audio.playAt(id);
    else audio.toggle();
  }, [shownSpotId, activeAudioIndex, audio]);
  // Entfernung bis zu IRGENDEINEM Stopp, nicht nur bis zum automatisch angebotenen.
  //
  // WAS HIER FALSCH WAR: Der Streifen bekam die Entfernung nur, wenn der gezeigte Stopp der
  // angebotene war, sonst null. Und null rendert als "Jetzt hier". Wer einen Stopp von Hand
  // antippte, las also "Jetzt hier" unter einem Ort, der zwei Kilometer weit weg war.
  //
  // `spotIds` bildet Tour-Index auf Routen-Index ab: Nach einer Neuberechnung sind nicht
  // mehr alle Stopps in der Route, die Positionen verschieben sich also.
  const distanceToStopM = useCallback(
    (tourIndex: number | null): number | null => {
      if (tourIndex == null || !bike.route) return null;
      const pos = bike.spotIds.indexOf(tourIndex);
      if (pos < 0) return null;
      const along = bike.route.spotAlongM[pos];
      if (along == null) return null;
      return along - bike.nav.alongM;
    },
    [bike.route, bike.spotIds, bike.nav.alongM],
  );

  const nextRouteSpot = bike.nav.nextSpotIndex >= 0 ? bike.spotIds[bike.nav.nextSpotIndex] : -1;
  const nextStop = nextRouteSpot >= 0 ? (geoStops[nextRouteSpot] ?? null) : null;

  // GEHOERT UND DORT GEWESEN = erledigt (bike-nav-core, atSpot). Ein Effekt fuer alle drei
  // Wege: Play am Ort (heard kommt eine Microtask nach dem Start), die Geschichte lief schon
  // beim Ankommen (atSpot wird wahr), oder der Halt wurde zuhause vorgehoert und ist jetzt
  // erreicht. Geprueft wird NUR der Ziel-Halt: Wer aus der Liste einen spaeteren Halt
  // vorhoert, rueckt nichts weiter, und wer die Geschichte des Ziel-Halts zwei Kilometer
  // vorher hoert, bleibt auf dem Weg dorthin. X und Vorbeifahren bleiben die Netze darunter.
  // "Gehoert" heisst gestartet, nicht zu Ende gehoert: Nichts hier wartet auf das Ende.
  const zielPhase =
    bike.nav.nextSpotIndex >= 0 ? (bike.nav.spotPhase[bike.nav.nextSpotIndex] ?? null) : null;
  const zielLuftlinieM =
    fix && nextStop?.lat != null && nextStop.lng != null
      ? haversineMeters([fix.lng, fix.lat], [nextStop.lng, nextStop.lat])
      : null;
  const zielErreicht =
    nextRouteSpot >= 0 &&
    heard.has(nextRouteSpot) &&
    zielPhase != null &&
    atSpot(zielPhase, zielLuftlinieM);
  const markSpotDone = bike.markSpotDone;
  useEffect(() => {
    if (!zielErreicht) return;
    const id = nextRouteSpot;
    void Promise.resolve().then(() => markSpotDone(id));
  }, [zielErreicht, nextRouteSpot, markSpotDone]);

  // Speichern, sobald sich Erledigtes oder Gehoertes aendert (bike-nav-memory.ts). NUR
  // wenn die Route steht: Vorher beschreiben spotIds und der Kern-Zustand noch "alles
  // offen" und wuerden den Eintrag ueberschreiben, bevor das Gate ihn gelesen hat.
  // Erledigt ist, was nicht mehr in der Route ist (nach einer Neuberechnung fallen die
  // abgehakten Halte heraus) oder in der Route auf "done" steht. Ueber Schluessel-Strings
  // statt der Arrays, weil der Kern seine Phasen bei jedem Fix neu kopiert.
  const reallyDone = bike.finished && bike.nav.nextSpotIndex < 0;
  const doneKey = useMemo(() => {
    const done = new Set<number>();
    for (let i = 0; i < geoStops.length; i++) if (!bike.spotIds.includes(i)) done.add(i);
    bike.spotIds.forEach((id, pos) => {
      if (bike.nav.spotPhase[pos] === "done") done.add(id);
    });
    return Array.from(done).sort((a, b) => a - b).join(",");
  }, [bike.spotIds, bike.nav.spotPhase, geoStops.length]);
  const heardKey = Array.from(heard).sort((a, b) => a - b).join(",");
  useEffect(() => {
    if (bike.status !== "ready") return;
    if (reallyDone) {
      clearRide(tour.slug); // die naechste Fahrt beginnt wieder am Start
      return;
    }
    const parse = (k: string) => (k ? k.split(",").map(Number) : []);
    writeRide(tour.slug, { done: parse(doneKey), heard: parse(heardKey) });
  }, [bike.status, reallyDone, doneKey, heardKey, tour.slug]);

  const maneuverStep =
    bike.route && bike.nav.stepIndex >= 0 ? (bike.route.steps[bike.nav.stepIndex] ?? null) : null;
  const etaMin = bike.status === "ready" ? estimateEtaMin(bike.nav.remainingM, fix?.speedMps ?? null) : null;

  const totalM = bike.route?.distanceM ?? 0;

  // ROT IST NUR DIE AKTUELLE ETAPPE, von einem Halt zum naechsten.
  //
  // Bis 25.08.2026 zeichnete die Karte die GANZE Runde rot und graute den gefahrenen Teil
  // aus. Auf Runde A sind 2,44 von 9,59 km doppelt befahren, gemessen: zwei Sackgassen und
  // ein Uferkorridor, den sie zweimal benutzt. Dort lagen Grau und Rot auf denselben
  // Pixeln. Der Gast sah ein Knaeuel und konnte nicht ablesen, wohin er fahren soll.
  //
  // Jetzt gibt es zwei Linien mit klarer Arbeitsteilung: die blasse Haarlinie zeigt die
  // FORM der Runde und aendert sich nie, die rote Linie ist die Zusage "hier entlang,
  // jetzt". Der zweite Durchgang durch denselben Korridor liegt in einer anderen Etappe
  // und wird gar nicht gezeichnet, solange er nicht dran ist.
  //
  // DIE ROTE LINIE BEGINNT AM ROUTENANFANG, NICHT AM VORIGEN HALT (seit 15.09.2026). Die
  // Ausblendung (line-trim-offset, NavMap) macht den gefahrenen Teil ohnehin unsichtbar,
  // die Geometrie wechselt weiterhin nur, wenn der naechste Halt wechselt. Vorher begann
  // sie an der Marke des vorigen Halts, und wer diesen Halt 200 m VOR dem Ort abgehakt
  // hatte (X, oder Play beim Ankommen), sah bis dorthin keine rote Linie unter seinem
  // Punkt: Die Etappe fing vor ihm an. Mit dem Play-Vorruecken waere das der Normalfall.
  const { leg, legProgress, ahead } = useMemo(() => {
    const g = bike.route?.geometry;
    if (!g?.length || totalM <= 0) return { leg: null, legProgress: 0, ahead: null };
    const marken = bike.route!.spotAlongM;
    const naechste = bike.nav.nextSpotIndex;
    // Ab: die Marke des zuletzt abgehakten Halts, nur fuer die Entartungs-Pruefung unten.
    // Bis: der naechste Halt, sonst das Rundenende (nach dem letzten Halt ist die Etappe
    // der Rueckweg zum Start).
    const abM = naechste > 0 ? (marken[naechste - 1] ?? 0) : 0;
    let bisM = naechste >= 0 ? (marken[naechste] ?? totalM) : totalM;

    // ENTARTETE ETAPPEN UEBERSPRINGEN. Auf einer Rundtour sitzt Halt 1 AM STARTPUNKT, seine
    // Marke liegt also bei rund null Meter. Die erste Etappe waere damit 0 bis 0 Meter lang,
    // sliceAlong gaebe nichts zurueck, und die Karte zeigte gar keine rote Linie: genau der
    // Zustand, in dem der Gast losfaehrt und nicht weiss, wohin.
    //
    // Dasselbe passiert an einer Sackgasse, wo zwei Halte dicht beieinander liegen. Deshalb
    // bis zur naechsten Marke weitersuchen, die wirklich vor uns liegt. Bewusst an den
    // Marken gemessen und nicht an der Position, damit die Geometrie nicht flackert.
    let j = naechste;
    while (bisM - abM < 50 && j >= 0 && j + 1 < marken.length) {
      j += 1;
      bisM = marken[j] ?? totalM;
    }
    if (bisM - abM < 50) bisM = totalM;

    if (bisM <= 1) return { leg: g, legProgress: 0, ahead: null };
    return {
      leg: sliceAlong(g, 0, bisM),
      legProgress: Math.min(1, Math.max(0, bike.nav.alongM / bisM)),
      // WAS NOCH KOMMT, blass darunter: vom Ende der aktuellen Etappe bis zum Rundenende.
      //
      // Nicht die ganze Runde: Was hinter dem Gast liegt, hat er hinter sich, und Googles
      // eigene Uebersicht zeigt bei Mehrziel-Fahrten ausdruecklich nur "the untraveled
      // portion of the route".
      //
      // Und bewusst erst AB dem naechsten Halt, nicht ab der aktuellen Position: So
      // ueberlagern sich die blasse und die rote Linie nie, und die blasse muss nur
      // siebenmal je Runde neu gesetzt werden statt bei jedem Messwert.
      ahead: bisM < totalM - 1 ? sliceAlong(g, bisM, totalM) : null,
    };
  }, [bike.route, bike.nav.nextSpotIndex, bike.nav.alongM, totalM]);


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
        route={leg}
        shape={ahead}
        progress={legProgress}
        fix={fix ? { lng: fix.lng, lat: fix.lat } : null}
        bearingDeg={bike.nav.bearingDeg}
        stops={navStopPoints}
        onStopTap={pickStop}
        activeIndex={nextRouteSpot >= 0 ? nextRouteSpot : geoStops.length - 1}
        paddingBottom={offeredStop ? 240 : 190}
        recenterLabel={t("navRecenter")}
      />

      {tour.isDraftPreview && (
        // Ein Admin sieht hier einen ENTWURF. Ohne diesen Streifen sieht das aus wie die
        // veroeffentlichte Runde, und genau daran haengt die Frage, ob Gaeste sie schon
        // finden koennen.
        <div className="pointer-events-none absolute inset-x-0 top-0 z-[48] flex justify-center pt-[calc(env(safe-area-inset-top)+2px)]">
          <span className="rounded-full bg-amber-400/95 px-3 py-1 text-[11px] font-bold tracking-wide text-black shadow">
            ENTWURF, nur für dich sichtbar
          </span>
        </div>
      )}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-[46] flex items-start justify-between gap-2 px-3 pt-[calc(env(safe-area-inset-top)+10px)]">
        <div className="pointer-events-auto">
          {/* Ohne label: Der Tourtitel war eine breite Textflaeche direkt neben dem
              Abbiege-Banner, dem Wichtigsten auf dem Schirm. Der Pfeil genuegt, wohin er
              fuehrt weiss man, weil man gerade von dort kam. */}
          <BackButton fallbackHref={`/touren/${tour.slug}`} />
        </div>
      </div>

      {/* Oben die naechste Anweisung. Faehrt der Gast die Route rueckwaerts, steht hier
          statt der Abbiegung "Bitte umdrehen" (bike-nav-core, wrongWay): Die naechste
          Abbiegung laege hinter ihm und waere die falsche Ansage. */}
      {!showStartGate && !bike.finished && (bike.wrongWay || maneuverStep) && (
        <div className="pointer-events-none absolute inset-x-3 z-[45] top-[calc(env(safe-area-inset-top)+64px)]">
          {bike.wrongWay ? (
            <ManeuverBanner
              instruction={t("navWrongWay")}
              distanceM={null}
              type="wrong-way"
              modifier="uturn"
            />
          ) : (
            maneuverStep && (
              <ManeuverBanner
                instruction={maneuverStep.instruction}
                distanceM={bike.nav.distanceToManeuverM}
                type={maneuverStep.type}
                modifier={maneuverStep.modifier}
                followedBy={maneuverStep.followedBy}
              />
            )
          )}
        </div>
      )}

      {/* Unterer Stapel: Angebot/Player ÜBER der Zielleiste. Beide bleiben sichtbar, das
          Audio verdeckt die Führung nicht (Wunsch 6 in docs/40). */}
      {!showStartGate && !bike.finished && (
        <div className="pointer-events-none absolute inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+44px)] z-[45] space-y-2">
          {/* Empfangsverlust MUSS sichtbar sein. Vorher fiel "signal-lost" durch jede
              Bedingung: Das Start-Gate deckt nur idle/denied/unavailable ab, also blieb
              der Fahrbildschirm normal stehen und zeigte weiter die letzte bekannte
              Position, Distanz und Abbiegung. Auf dem Rad ist das die gefaehrlichste Art
              Fehler, weil man ihm weiter folgt, ohne zu merken, dass er eingefroren ist. */}
          {gpsStatus === "signal-lost" && (
            <p className="sg-nav-card rounded-full px-3 py-1.5 text-center text-[12px] font-semibold text-accent">
              {t("navSignalLost")}
            </p>
          )}
          {bike.rerouting && (
            <p className="sg-nav-card rounded-full px-3 py-1.5 text-center text-[12px] font-semibold text-accent">
              {t("navRerouting")}
            </p>
          )}
          {/* Am FEHLER, nicht am Status: Schlaegt eine Neuberechnung fehl, waehrend die
              alte Route steht, bleibt der Status "ready" (use-bike-navigation), und die
              Pille kam nie, obwohl ihr Text genau diesen Fall meint. Gemessen im
              Offline-Szenario des Fahrsimulators am 15.09.2026. */}
          {!bike.rerouting && bike.error != null && (
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
              distanceM={distanceToStopM(shownSpotId)}
              audio={audio}
              isCurrent={activeAudioIndex === shownSpotId}
              onPlay={playOffered}
              onDismiss={dismissShown}
              onOpenDetails={() => setDetailsOpen(true)}
            />
          )}

          {/* Die Zielleiste ist zugleich der Weg zu ALLEN Stopps. Apple und Google Maps
              machen es genauso: Die Leiste unten ist nicht nur Anzeige, sie geht auf. Ein
              eigener Knopf daneben waere ein weiteres Ziel auf einem Bildschirm, auf dem
              schon zu viel um Platz kaempft. */}
          <button
            type="button"
            onClick={() => setStopsOpen(true)}
            className="pointer-events-auto block w-full text-left"
            aria-label={t("navAllStops")}
          >
            <NextStopBar
              stopEmoji={nextStop?.emoji ?? null}
              stopTitle={nextStop?.title ?? null}
              toStopM={bike.nav.distanceToNextSpotM}
              remainingM={bike.nav.remainingM}
              etaMin={etaMin}
            />
          </button>
        </div>
      )}

      {/* Ende der Runde. Vorher lief der Zähler einfach weiter und der Gast blieb auf
          einem halb toten Bildschirm zurück: untere Leiste weg, alte Linie liegen
          geblieben, kein Weg heraus. */}
      {/* Der Vorhang faellt erst, wenn die Runde WIRKLICH durch ist: am Ziel UND kein Halt
          mehr offen. Auf einer Rundtour liegt das Ziel am Start, ein Ausreisser in
          Startnaehe sah sonst wie ein Zieleinlauf aus. Der Kern kennt diese Bedingung schon
          als `reallyDone`, benutzte sie aber nur, um die Neuberechnung ruhen zu lassen. */}
      {reallyDone && (
        <div className="absolute inset-0 z-[50] flex flex-col items-center justify-end bg-black/45 p-6 pb-[calc(env(safe-area-inset-bottom)+32px)] backdrop-blur-sm">
          <div className="sg-nav-card w-full max-w-sm space-y-3 rounded-[22px] p-6 text-center">
            {/* KEINE ZAHL MEHR. Hier stand "{heard} von {total} Stationen gehoert", und das
                ist genau die Anzeige, die schadet: Silverman und Barasch haben 2023 im
                Journal of Consumer Research gemessen, dass nicht das Auslassen demotiviert,
                sondern das ANZEIGEN des Auslassens. Dieselbe Handlung, nur anders
                dargestellt, kostete acht Prozentpunkte Weitermachen.
                Wer drei von sieben Geschichten gehoert hat, hat eine schoene Runde gefahren
                und bekommt hier keine Bilanz vorgelegt. Auch das Konfetti geht: Es stimmt
                nicht, wenn jemand bei Halt vier aufgehoert hat. */}
            <p className="text-[19px] font-bold text-ink">{t("navDoneTitle")}</p>
            <Link
              href={`/touren/${tour.slug}`}
              className="sg-nav-on-accent flex items-center justify-center rounded-full bg-accent px-5 py-3 text-[15px] font-semibold transition active:scale-[0.98]"
            >
              {t("navDoneBack")}
            </Link>
            {/* Der Ausweg. Ohne ihn war jeder Fehlalarm ein Totalausfall mitten auf dem
                Rad: Der Vorhang legte sich ueber die ganze Fuehrung und der einzige Knopf
                fuehrte aus der Navigation heraus. Der Kern entscheidet inzwischen
                entprellt und plausibel, aber unfehlbar ist kein Verfahren. */}
            <button
              type="button"
              onClick={bike.clearFinished}
              className="w-full rounded-full px-5 py-2.5 text-[14px] font-semibold text-muted transition active:scale-[0.98]"
            >
              {t("navDoneContinue")}
            </button>
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
            {/* Die Knoepfe erst, wenn das Gedaechtnis gelesen ist (eine Microtask nach dem
                ersten Bild): Sonst stuende kurz "Navigation starten" da und spraenge auf
                "Weiterfahren" um. Wer mitten in der Runde neu oeffnet (Tab zu, Handy aus,
                zurueck von der Kasse), faehrt mit EINEM Tipp dort weiter, wo er war. */}
            {memory !== "loading" &&
              (resumable ? (
                <>
                  <button
                    type="button"
                    onClick={resumeRide}
                    className="sg-nav-on-accent w-full rounded-full bg-accent px-5 py-3 text-[15px] font-semibold active:scale-[0.98]"
                  >
                    🧭 {t("navResume", { n: resumeOrder, total: geoStops.length })}
                  </button>
                  <button
                    type="button"
                    onClick={restartRide}
                    className="w-full rounded-full px-5 py-2.5 text-[14px] font-semibold text-muted transition active:scale-[0.98]"
                  >
                    {t("navRestart")}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={beginNavigation}
                  className="sg-nav-on-accent w-full rounded-full bg-accent px-5 py-3 text-[15px] font-semibold active:scale-[0.98]"
                >
                  🧭 {t("startNavigation")}
                </button>
              ))}
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
      <StopListSheet
        open={stopsOpen}
        onClose={() => setStopsOpen(false)}
        stops={geoStops}
        currentIndex={shownSpotId}
        heard={heard}
        onPick={pickStop}
      />

      <ArrivalSheet
        open={detailsOpen && offeredStop != null}
        stop={offeredStop}
        freeStops={tour.freeStops}
        totalStops={tour.stops.length}
        proPrice={proPrice}
        tourSlug={tour.slug}
        voice={tour.voice}
        audio={audio}
        isCurrent={shownSpotId != null && shownSpotId === activeAudioIndex}
        onPlayThis={playOffered}
        index={activeAudioIndex}
        total={playerStops.length}
        onContinue={() => setDetailsOpen(false)}
      />
    </div>
  );
}
