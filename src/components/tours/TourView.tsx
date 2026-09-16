"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import SpotMap, { type MapMarker } from "@/components/SpotMap";
import MobileSheet from "@/components/MobileSheet";
import PartnerCredits from "@/components/PartnerCredits";
import ProPurchase from "@/components/ProPurchase";
import BackButton from "@/components/BackButton";
import ActionTile from "@/components/ActionTile";
import { buildMapsLink } from "@/lib/maps";
import { useTourAudio, type PlayerStop } from "./useTourAudio";
import AudioTransport from "./AudioTransport";
import TranscriptView from "./TranscriptView";
import VoiceDisclosure from "./VoiceDisclosure";
import type { TourDetail } from "@/lib/tour-types";
import { chainCoords, flattenChain } from "@/lib/tour-route";
import { useSheetPeek } from "@/lib/sheet-metrics";
import { TOUR_MODE_EMOJI } from "@/lib/tour-mode";
import { kmLabel } from "@/lib/tour-format";

// Im Ruhezustand zeigt das Sheet die RUNDE und genau eine Aktion: Titel, eine leise
// Faktenzeile, ein Knopf. Vorher stand hier der Mini-Player des ersten Stopps, und damit
// las die Seite sich so: „STOPP 1 VON 6 – Marko-Feingold-Steg". Wer über die Runden-Liste
// oder einen geteilten Link kam, sah den Namen einer Brücke, nie den Namen der Runde; der
// stand nur im unsichtbaren <h1>. Dazu zwei rote Knöpfe untereinander (Navigation + Play)
// und das Kaufangebot ganz unten, hinter der Stopp-Liste und den Anfahrt-Kacheln.
//
// Der Wert ist die Schätzung fürs Server-HTML: Griff 26 + pt-1 4 + Titel 28 + Faktenzeile
// 6 + 17 + Knopf 16 + 52 + 16 Luft. Gemessen wird trotzdem am Anker (ResizeObserver in
// MobileSheet); die Zahl gilt nur für den ersten Paint, und ein zweizeiliger Titel oder
// eine Runde ohne Fahrbildschirm ändert sie.
const SHEET_PEEK = { fits: '[data-sg="tour-peek"]', fallback: "calc(165px + var(--sg-nav-h))" };
// Ohne Peek – die ist beim Sheet eine eigene Angabe.
const SHEET_DETENTS = [0.62, 1];

export default function TourView({
  tour,
  proPrice = "",
  navHref,
  onRestart,
  topRight,
}: {
  tour: TourDetail;
  /**
   * Preis aus Stripe, serverseitig geholt. Gesetzt heisst: Der Kauf passiert auf dieser
   * Seite und führt danach hierher zurück. Leer heisst: Stripe war nicht erreichbar (oder
   * die Aufrufstelle kennt keinen Preis), dann bleibt der Weg über /pro.
   */
  proPrice?: string;
  /**
   * Pfad zum Navigations-Bildschirm dieser Runde (ohne Sprach-Praefix). Gesetzt heisst:
   * Der grosse Knopf im Ruhezustand fuehrt dorthin, am Rad wie zu Fuss (seit 16.09.2026,
   * vorher nur bei mode="bike"). Fehlt er (die Vorschau im Builder hat noch keine URL),
   * spielt der Knopf den ersten offenen Stopp.
   */
  navHref?: string;
  onRestart?: () => void;
  topRight?: React.ReactNode;
}) {
  const t = useTranslations("Tours");
  const tPro = useTranslations("Pro"); // Knopfbeschriftung: eine Quelle, siehe SpotSheet.tsx
  const locale = useLocale();
  const [active, setActive] = useState(0);
  const [focused, setFocused] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  // Die Peek-Höhe, die das Sheet gemessen hat – dieselbe Zahl, aus derselben Quelle.
  // Vorher rechnete das Karten-Padding den Anteil hier noch einmal nach; sobald sich der
  // Peek nach dem Inhalt richtet, kann man ihn nicht mehr nachrechnen, nur noch lesen.
  const peekPx = useSheetPeek();

  // Desktop/Mobile messen. Die Viewport-Höhe hängt bewusst NICHT an diesem resize:
  // iOS feuert resize bei jedem Leisten-Zug (siehe lib/viewport.ts).
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const u = () => {
      setIsDesktop(mq.matches);
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

  // Tipp auf eine Stopp-Zeile: auswählen UND anspielen. Ein Tipp, nicht zwei.
  //
  // Auf dieser Seite entscheidet sich, ob jemand die Runde kauft, und das stärkste Argument
  // ist eine Geschichte, die man gehört hat. Sie darf nicht hinter einem zweiten Tipp auf
  // einen Play-Knopf liegen. (Auf dem Rad gilt das Gegenteil, dort startet nichts von
  // selbst – docs/40. Hier ist der Tipp die Absicht, dort wäre es die Ankunft.)
  //
  // Ein gesperrter Stopp wird nur ausgewählt: Die Karte fliegt hin, die Zeile klappt auf
  // und sagt, warum hier Schluss ist. Antworten tut der Kaufblock unter der Liste.
  const pickStop = (i: number) => {
    const s = tour.stops[i];
    selectStop(i);
    if (s?.locked || !s?.audioUrl) {
      audio.pause();
      return;
    }
    if (i === active) audio.toggle();
    else audio.playAt(i);
  };

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
  // Eigenes Ziel (kuratierte Runden). Liegt es auf dem Start, ist es ein Rundweg und
  // die Flagge bliebe unter dem Start-Pin liegen -> dann keinen zweiten Pin setzen.
  const endMarker: MapMarker | null =
    tour.end &&
    tour.end.lat != null &&
    tour.end.lng != null &&
    !(
      startMarker &&
      Math.abs(startMarker.lat - tour.end.lat) < 1e-5 &&
      Math.abs(startMarker.lng - tour.end.lng) < 1e-5
    )
      ? { slug: "__end__", lat: tour.end.lat, lng: tour.end.lng, emoji: "🏁", title: t("finish") }
      : null;
  const markers: MapMarker[] = [
    ...(startMarker ? [startMarker] : []),
    ...stopMarkers,
    ...(endMarker ? [endMarker] : []),
  ];
  // Echte, an Straßen gesnappte Route (Normalfall). Fehlt sie (Routing-Dienst war nicht
  // erreichbar), keine losen Segmente zeigen: die Ersatzlinie läuft vom Start über die
  // Stops (und die Wegpunkte des Admins, 0071) zum Ziel, und ohne eigenes Ziel zurück zum
  // Start, damit die Runde wenigstens am Start verankert ist (so laufen die KI-Runden, die
  // immer Rundwege sind).
  const fallbackLine = (): [number, number][] | null => {
    const start = startMarker ? { lat: startMarker.lat, lng: startMarker.lng } : null;
    const end = endMarker ? { lat: endMarker.lat, lng: endMarker.lng } : start;
    const line = chainCoords(
      flattenChain({
        start,
        end,
        stops: geoStops.map((s) => ({ id: s.spotSlug, coord: [s.lng as number, s.lat as number] })),
        via: tour.routeVia ?? [],
      }),
    );
    return line.length > 1 ? line : null;
  };
  const route: [number, number][] | null =
    tour.routeGeo && tour.routeGeo.length > 1 ? tour.routeGeo : fallbackLine();
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
  const sheetPad = isDesktop ? 40 : peekPx + 32;
  const mapPadding = isDesktop
    ? { top: 80, right: 80, left: 80, bottom: 80 }
    : { top: 96, right: 40, left: 40, bottom: sheetPad };
  const focus =
    focused && activeStop?.lat != null && activeStop?.lng != null
      ? { lng: activeStop.lng as number, lat: activeStop.lat as number, padTop: 96, padBottom: sheetPad }
      : null;

  // Darf der Player den aktiven Stopp überhaupt abspielen? Audio und Text laufen ZUSAMMEN
  // (Mitlesen), deshalb hängt beides am selben Stopp und nicht an zwei Zuständen.
  const canPlay = !!activeStop?.audioUrl && !activeStop?.locked;

  // ── Kopf-Chrome (Zurück/Andere-Runde + Speichern) — schwebt über der Karte ──
  const backControl = onRestart ? (
    <button
      type="button"
      onClick={onRestart}
      className="cursor-pointer inline-flex items-center gap-1 rounded-full bg-white/85 px-3.5 py-2 text-[14px] font-semibold text-ink shadow-md backdrop-blur-md transition active:scale-95"
    >
      ↺ {t("rebuild")}
    </button>
  ) : (
    <BackButton fallbackHref="/touren" label={t("backToList")} />
  );

  // Eine leise Faktenzeile, dieselbe Reihenfolge und dasselbe Trennzeichen wie auf der
  // Runden-Liste und der gespeicherten Runde: Wer dort eine Kachel antippt, liest hier
  // dieselbe Zeile wieder. Drei Angaben, mehr braucht der Kopf nicht.
  const facts = [
    t("stops", { count: tour.stops.length }),
    tour.durationMin != null ? t("minutes", { count: tour.durationMin }) : null,
    tour.distanceKm != null ? kmLabel(tour.distanceKm, locale) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  // Erster Stopp, den man wirklich hören kann. Er ist das Ziel des Knopfs „Tour starten"
  // bei Runden ohne Fahrbildschirm.
  const firstPlayable = tour.stops.findIndex((s) => !s.locked && !!s.audioUrl);
  const started = audio.playing || audio.time > 0;
  const startTour = () => {
    if (audio.playing || audio.time > 0) {
      audio.toggle();
      return;
    }
    if (firstPlayable < 0) return;
    selectStop(firstPlayable);
    audio.playAt(firstPlayable);
  };

  // GENAU EINE Aktion im Ruhezustand: der Navigations-Bildschirm, wo es einen gibt (die
  // Navigation kostet nichts, nur das Audio an den Stopps ist Pro). Am Rad UND zu Fuss
  // derselbe Knopf und dieselbe Seite dahinter; bis 16.09.2026 spielte er bei einer
  // Geh-Runde nur den ersten Stopp, und der Gast stand mit einer laufenden Geschichte da,
  // ohne zu wissen, wohin. Nur die Vorschau im Builder (keine URL) startet weiter die
  // Wiedergabe. Vorher standen beide untereinander, zwei rote Knöpfe, gleich laut.
  const cta =
    "flex w-full items-center justify-center gap-2 rounded-full bg-accent px-5 py-3.5 text-[16px] font-semibold text-white shadow-[0_10px_24px_-10px_rgba(204,41,36,0.55)] transition active:scale-[0.98]";
  const primaryAction =
    navHref ? (
      <Link href={navHref} className={`${cta} mt-4`}>
        🧭 {t("startNavigation")}
      </Link>
    ) : firstPlayable >= 0 ? (
      <button type="button" onClick={startTour} className={`cursor-pointer ${cta} mt-4`}>
        {audio.playing ? `⏸ ${t("pause")}` : started ? `▶ ${t("play")}` : `▶ ${t("start")}`}
      </button>
    ) : null;

  // ── Panel-Inhalt (identisch in Sheet [mobil] und Aside [Desktop]) ──
  const panel = (
    <div className="px-5">
      {/* Der Ruhezustand: die Runde und eine Aktion. Er ist zugleich der Anker, an dem der
          Peek sich misst (SHEET_PEEK oben) – deshalb steht hier NICHTS, was man auch
          später lesen kann. */}
      <div data-sg="tour-peek">
        <h2 className="text-balance text-[22px] font-bold leading-tight text-ink">{tour.title}</h2>
        <p className="mt-1.5 text-[13px] text-muted">
          {TOUR_MODE_EMOJI[tour.mode]} {facts}
        </p>
        {primaryAction}
      </div>

      {/* Der Einzeiler der Runde, sonst nichts: Die lange Beschreibung steht auf der
          Runden-Liste und in den Metadaten. Hier zählt, dass der Gast in einem Blick
          weiss, worauf er sich einlässt. */}
      {tour.subtitle && (
        <p className="mt-5 text-[14px] leading-relaxed text-muted">{tour.subtitle}</p>
      )}

      {/* ── Die Stopps ──
          Eine Zeile je Stopp, und die Zeile IST der Stopp: Ein Tipp wählt ihn aus (die
          Karte fliegt hin) und spielt ihn an, der ausgewählte klappt darunter auf und
          zeigt Wiedergabe, Stimmen-Hinweis und Text zum Mitlesen.

          Vorher standen beide Dinge getrennt: oben ein Block „STOPP 1 VON 6" mit Foto,
          Player und Transkript, darunter noch einmal die ganze Liste mit denselben
          Titeln. Derselbe Stopp zweimal auf einem Bildschirm, und dazwischen der längste
          Text der Seite.

          Dieselbe Zeilenform wie die Stopp-Liste im Fahrbildschirm (nav/StopListSheet):
          Kachel mit Nummer, Titel, eine leise Unterzeile, rechts der Zustand. */}
      <div className="mt-7">
        <p className="mb-3 px-1 text-[12px] font-semibold uppercase tracking-wide text-muted">
          {t("allStops")}
        </p>
        <ol className="space-y-2.5">
          {tour.stops.map((s, i) => {
            // Aufgeklappt wird erst, wenn der Gast einen Stopp GEWÄHLT hat (`focused`
            // ist genau das: gesetzt vom Tipp auf die Zeile, auf einen Pin, vom
            // Start-Knopf und vom Weiterschalten des Players). Beim Laden steht die
            // Liste damit kompakt da, sechs Zeilen statt einer aufgeschlagenen mit
            // Wiedergabe und Text – und der Kaufblock rückt um eine Bildschirmhöhe
            // nach oben. Dieselbe Bedingung fliegt die Karte an: Was aufgeklappt ist,
            // ist auch das, was die Karte zeigt.
            const on = focused && i === active;
            const rowLocked = s.locked;
            const rowPlayable = !rowLocked && !!s.audioUrl;
            return (
              <li
                key={`${s.spotSlug}-${i}`}
                className={`overflow-hidden rounded-[16px] bg-white/80 shadow-sm ring-1 transition ${
                  on ? "ring-2 ring-accent" : "ring-black/[0.04]"
                }`}
              >
                <button
                  type="button"
                  onClick={() => pickStop(i)}
                  className="sg-hit flex w-full items-center gap-3 p-2.5 text-left"
                >
                  <span className="relative shrink-0">
                    {s.imageUrl ? (
                      <Image
                        src={s.imageUrl}
                        alt=""
                        width={48}
                        height={48}
                        quality={62}
                        className="h-12 w-12 rounded-[12px] object-cover"
                      />
                    ) : (
                      <span className="flex h-12 w-12 items-center justify-center rounded-[12px] bg-black/[0.06] text-[22px]">
                        {s.emoji ?? "🎧"}
                      </span>
                    )}
                    <span className="absolute -left-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-ink text-[11px] font-bold text-cream">
                      {s.order}
                    </span>
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-semibold text-ink">
                      {s.title}
                    </span>
                    <span className="block text-[12px] text-muted">
                      {rowLocked
                        ? tPro("cta")
                        : on && audio.playing
                          ? t("playingNow")
                          : s.durationSec
                            ? t("minutes", { count: Math.max(1, Math.round(s.durationSec / 60)) })
                            : t("play")}
                    </span>
                  </span>

                  {/* Das Zeichen rechts sagt, was ein Tipp auf die ZEILE tut – es ist
                      kein eigener Knopf (die ganze Zeile ist einer). Am aufgeklappten
                      Stopp bleibt es weg: Dort steht die Wiedergabe zwei Zentimeter
                      tiefer, und zwei rote Play-Kreise übereinander wären eine Frage,
                      die keine ist. */}
                  {!on && (
                    <span
                      aria-hidden
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
                        rowLocked ? "bg-black/[0.06] text-[15px]" : "bg-accent text-white"
                      }`}
                    >
                      {rowLocked ? (
                        "🔒"
                      ) : (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M8 5.2v13.6a.8.8 0 0 0 1.23.67l10.4-6.8a.8.8 0 0 0 0-1.34L9.23 4.53A.8.8 0 0 0 8 5.2Z" />
                        </svg>
                      )}
                    </span>
                  )}
                </button>

                {on && (
                  <div className="px-2.5 pb-3">
                    {/* Foto: Titel, Bild und Position sind bei Touren öffentliche Teaser,
                        nur das Audio ist Pro (Migration 0029) – es bleibt also auch am
                        gesperrten Stopp stehen. */}
                    {s.imageUrl && (
                      <div className="relative mb-3 aspect-[16/10] overflow-hidden rounded-[14px] bg-black/5">
                        <Image
                          src={s.imageUrl}
                          alt=""
                          fill
                          sizes="(min-width: 768px) 27rem, 100vw"
                          quality={62}
                          className="object-cover"
                        />
                      </div>
                    )}
                    {rowLocked ? (
                      // Derselbe Satz wie in der Kauffläche, und er bricht genauso an der
                      // Satzgrenze. Die Antwort darauf steht im Kaufblock unter der Liste.
                      <p className="px-1 text-[13px] leading-snug text-muted">
                        <span className="block">
                          🔒 {t("lockedFree", { free: tour.freeStops })}
                        </span>
                        <span className="block">{t("lockedAll", { total: tour.stops.length })}</span>
                      </p>
                    ) : rowPlayable ? (
                      <>
                        <AudioTransport
                          audio={audio}
                          index={active}
                          total={tour.stops.length}
                          canPlay={canPlay}
                        />
                        {/* Stimmen-Hinweis (Ehrlichkeit + Art. 50 KI-VO, docs/39): steht
                            direkt an der Wiedergabe, also bevor jemand sie startet. */}
                        <VoiceDisclosure voice={tour.voice} />
                        {s.audioText && (
                          <div className="mt-4">
                            <TranscriptView text={s.audioText} />
                          </div>
                        )}
                      </>
                    ) : (
                      <p className="px-1 text-[13px] text-muted">{t("noAudio")}</p>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      </div>

      {/* ── Der Kauf, direkt unter den Schlössern ──
          Vorher stand hier ganz unten, hinter der Stopp-Liste UND den Anfahrt-Kacheln, ein
          Fließtext mit einem Knopf auf /pro: kein Preis, ein Seitenwechsel, und am iPhone
          erst nach 1700 px Scrollen zu sehen. Jetzt beantwortet der Block die Frage, die
          die Schlösser eine Zeile weiter oben stellen, und zwar an Ort und Stelle.
          Derselbe Kaufblock wie im Fahrbildschirm (ProPurchase) – eine Quelle für Preis,
          § 18-Häkchen, Knopftext und das Kleingedruckte. */}
      {tour.isPro && !tour.canSeePro && (
        <div className="mt-8 rounded-[18px] bg-white/70 p-5 shadow-sm ring-1 ring-black/[0.04]">
          <p className="text-center text-[13px] leading-snug text-muted">
            <span className="block">🔒 {t("lockedFree", { free: tour.freeStops })}</span>
            <span className="block">{t("lockedAll", { total: tour.stops.length })}</span>
          </p>
          {proPrice ? (
            <ProPurchase
              price={proPrice}
              returnTour={tour.slug}
              density="sheet"
              className="mt-3"
            />
          ) : (
            // Ohne Preis (Stripe nicht erreichbar) bleibt der alte Weg. Besser ein
            // Seitensprung als eine Kauffläche, die keinen Preis nennen kann: § 8 Abs. 1
            // FAGG verlangt ihn unmittelbar vor der Vertragserklärung.
            <Link href="/pro" className={`${cta} mt-4`}>
              {tPro("cta")}
            </Link>
          )}
        </div>
      )}

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

      {/* Partner-Nennung: Pflicht auf jeder Seite (lib/partners.ts). Hier im Panel, weil
          der LegalFooter auf den Vollbild-Karten nicht rendert (lib/routes.ts). */}
      <PartnerCredits className="mt-14" />
    </div>
  );

  return (
    <div className="fixed inset-0 z-0 md:top-[var(--sg-header-h)]">
      {/* Seiten-Überschrift für Suchmaschinen und Screenreader: Der Tour-Titel steht
          sonst nirgends im DOM (sichtbar ist nur der aktive Stopp im Mini-Player).
          sr-only statt sichtbar, weil die Karte die Bühne ist. Einmal HIER statt im
          panel: Das panel rendert doppelt (Sheet + Aside), zwei h1 wären die Folge. */}
      <h1 className="sr-only">{tour.title}</h1>
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
              if (slug === "__start__" || slug === "__end__") return;
              const i = tour.stops.findIndex((st) => st.spotSlug === slug);
              if (i >= 0) selectStop(i);
            }}
          />
        ) : (
          <div className="h-full w-full bg-cream" />
        )}
      </div>

      {/* Kopf-Chrome schwebt über der Karte (nur mobil; Desktop im Panel-Kopf) */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-[46] flex items-start justify-between gap-2 px-3 pt-[calc(var(--sg-sat)+10px)] md:hidden">
        <div className="pointer-events-auto">{backControl}</div>
        <div className="pointer-events-auto">{topRight}</div>
      </div>

      {/* Welche Ansicht gilt, entscheidet CSS – nicht ein State, der erst nach der
          Hydration stimmt. Vorher hing das an `isDesktop` (Startwert false), also
          rendete der Server IMMER die Handy-Ansicht und der PC zeigte für einen Moment
          ein breitgezogenes iPhone. Gemessen waren das 386ms, auf einem kalten Laden
          deutlich mehr. Dasselbe Muster wie in Explore.tsx.
          `isDesktop` bleibt für das Karten-Padding: Mapbox will Zahlen, das kann CSS nicht. */}
      <aside className="absolute inset-y-0 left-0 z-10 hidden w-[var(--sg-panel)] flex-col border-r border-black/5 bg-cream/95 backdrop-blur-xl md:flex">
        <div className="flex items-center justify-between gap-2 px-4 pt-4">
          {backControl}
          {topRight}
        </div>
        {/* pb aus --sg-page-bottom: gleicher Abschluss-Weissraum wie an jedem anderen
            Seitenende (globals.css) — vorher stand hier ein eigenes pb-16. */}
        <div className="flex-1 overflow-y-auto pb-[var(--sg-page-bottom)] pt-6">{panel}</div>
      </aside>
      {/* `contents`: am Handy darf der Wrapper das Layout nicht anfassen, sonst verliert
          das Sheet seinen Bezug zum `fixed inset-0` darüber. Ab md fällt der ganze
          Teilbaum per display:none weg. */}
      <div className="contents md:hidden">
        <MobileSheet hide={false} peek={SHEET_PEEK} detents={SHEET_DETENTS}>
          {panel}
        </MobileSheet>
      </div>
    </div>
  );
}
