"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ExploreCategory, ExploreSpot } from "@/lib/spots";
import { getSpotRoute } from "@/lib/spot-actions";
import { useAi } from "./ai/AiProvider";
import Carousel from "./Carousel";
import SpotCardDesktop from "./SpotCardDesktop";
import SpotSheet, { SPOT_SHEET_PEEK } from "./SpotSheet";
import SeasonToggle, { type Season } from "./SeasonToggle";
import SpotCard from "./SpotCard";
import SpotMap, { type MapMarker } from "./SpotMap";
import MobileSheet, { type Detent } from "./MobileSheet";
import { SHEET_PEEK_VAR, useSheetPeek } from "@/lib/sheet-metrics";
import { useViewportHeight } from "@/lib/viewport";

// Stufen des Explore-Sheets über dem Peek.
//
// Die mittlere ist bewusst KEIN Anteil, sondern am Inhalt gemessen: Sie ist genau so
// hoch, dass das erste Regal ganz drübersteht – Überschrift, Karussell und darin Titel
// UND Untertitel der Karten. Damit ist die Stufe das, was man dort erwartet: eine Reihe
// zum Durchwischen und Lesen. Als fester Anteil ginge das nicht, weil eine Karte 76vw
// breit ist und ein 4:3-Bild trägt – sie ist auf jedem iPhone unterschiedlich hoch.
// Der Fallback greift nur, solange kein Regal da ist (leere Saison).
const EXPLORE_DETENTS: Detent[] = [
  { fits: '[data-sg="first-shelf"]', fallback: 0.5 },
  0.9,
];

function defaultSeason(): Season {
  const m = new Date().getMonth(); // 0 = Jan
  return m === 11 || m <= 2 ? "winter" : "summer"; // Dez–März = Winter
}

// Sichtbarer Rand (px) zwischen eingepasstem Spot/Route und Header bzw. Sheet.
const FIT_GAP = 24;

export default function Explore({
  spots,
  categories,
  savedSlugs = [],
  loggedIn = false,
}: {
  spots: ExploreSpot[];
  categories: ExploreCategory[];
  savedSlugs?: string[];
  loggedIn?: boolean;
}) {
  const t = useTranslations("Explore");
  const [season, setSeason] = useState<Season>(defaultSeason);
  const [isDesktop, setIsDesktop] = useState(false);
  // Stabile Viewport-Höhe statt window.innerHeight: Das Karten-Padding hängt daran,
  // und innerHeight springt, sobald Safari beim Scrollen seine Leisten einfährt –
  // die Karte hätte dabei mitten in der Geste neu eingepasst (siehe lib/viewport.ts).
  const vh = useViewportHeight();
  // Höhe des überlagernden Mobile-Headers (inkl. Safe-Area/Notch) – gemessen, damit
  // der eingepasste Spot nicht unter den Header rutscht (auf iPhones mit Notch höher).
  const [headerH, setHeaderH] = useState(56);
  const [previewSlug, setPreviewSlug] = useState<string | null>(null);
  const [sheetClosing, setSheetClosing] = useState(false);
  // Das Sheet fährt gerade raus. Karte und Sheet müssen zusammen gehen: Route und
  // hervorgehobener Pin hängen an diesem Zustand, nicht am Ende der Sheet-Animation.
  // Vorher blieben beide die vollen 0.5s stehen und schnappten dann weg.
  const [dismissing, setDismissing] = useState(false);
  // Solange eine Spot-Vorschau offen ist, hält Toni seine Sprechblase zurück – beide
  // schweben unten rechts und lägen sonst übereinander.
  const { setOverlayOpen } = useAi();
  useEffect(() => {
    setOverlayOpen(!!previewSlug);
    return () => setOverlayOpen(false); // beim Verlassen der Seite nicht blockiert lassen
  }, [previewSlug, setOverlayOpen]);
  // On-demand geladene Wanderrouten (pro Spot), clientseitig gecacht -> die
  // Startseite lädt keine Routen vorab (Performance). null = keine Route.
  const [routeCache, setRouteCache] = useState<Record<string, [number, number][] | null>>({});
  // Live-Merkzustand = Quelle der Wahrheit fürs Bookmark der Vorschau. Init aus
  // Server-Daten, in der Session live gehalten -> kein falscher Zustand beim
  // Spot-Wechsel oder nach dem Merken.
  const [savedSet, setSavedSet] = useState<Set<string>>(() => new Set(savedSlugs));

  // gespeicherte Saison laden (über eine Microtask-Grenze -> kein synchrones
  // setState im Effekt-Body, verhindert Kaskaden-Renders)
  useEffect(() => {
    void Promise.resolve().then(() => {
      const s = localStorage.getItem("sg-season");
      if (s === "summer" || s === "winter") setSeason(s);
    });
  }, []);

  // Desktop/Mobile erkennen + Header messen. Die Viewport-Höhe kommt aus
  // useViewportHeight() und hat hier absichtlich nichts mehr verloren: Sie darf
  // NICHT an diesem resize hängen, weil iOS bei jedem Leisten-Zug resize feuert.
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const u = () => {
      setIsDesktop(mq.matches);
      // sichtbaren (nicht display:none) Header messen -> reale überlagerte Höhe
      const hdr = Array.from(document.querySelectorAll("header")).find(
        (h) => h.getBoundingClientRect().height > 0,
      );
      if (hdr) setHeaderH(Math.round(hdr.getBoundingClientRect().height));
    };
    u();
    mq.addEventListener("change", u);
    window.addEventListener("resize", u);
    return () => {
      mq.removeEventListener("change", u);
      window.removeEventListener("resize", u);
    };
  }, []);

  // Höhe des eingefahrenen Sheets in px – aus derselben CSS-Variable, aus der sich das
  // Sheet selbst positioniert. Mapbox nimmt für fitBounds nur Zahlen, keine CSS-Werte.
  const sheetPeek = useSheetPeek();

  // fitBounds-Padding (damit Marker nicht verdeckt werden):
  // - Desktop: Sidebar ist per md:left-[380px] ausgespart; unten extra Platz für die
  //   Glas-Navleiste (~76px) + Puffer.
  // - Mobile: unten der Platz, den das Peek-Sheet abdeckt (inkl. Tab-Leiste, die in
  //   --sg-sheet-peek schon drinsteckt) + derselbe sichtbare Rand wie oben.
  const mapPadding = useMemo(
    () =>
      isDesktop
        ? { top: 70, right: 70, left: 70, bottom: 70 }
        : { top: 120, right: 40, left: 40, bottom: sheetPeek + FIT_GAP },
    [isDesktop, sheetPeek],
  );

  const changeSeason = useCallback((s: Season) => {
    setSeason(s);
    try {
      localStorage.setItem("sg-season", s);
    } catch {
      // localStorage evtl. nicht verfügbar – ignorieren
    }
  }, []);

  const seasonSpots = useMemo(
    () => spots.filter((s) => s.seasons.includes(season)),
    [spots, season],
  );
  const seasonCats = useMemo(
    () => categories.filter((c) => c.season === season),
    [categories, season],
  );
  const markers = useMemo<MapMarker[]>(
    () =>
      seasonSpots
        .filter((s) => s.lat != null && s.lng != null)
        .map((s) => ({
          slug: s.slug,
          lat: s.lat as number,
          lng: s.lng as number,
          emoji: s.emoji,
          locked: s.locked,
          title: s.title,
        })),
    [seasonSpots],
  );

  // Einziger Weg, einen Spot zu öffnen — auch aus einem laufenden Schließen heraus.
  // Beide Riegel müssen fallen, sonst bliebe die Route des neuen Spots aus.
  const openSpot = useCallback((slug: string) => {
    setSheetClosing(false);
    setDismissing(false);
    setPreviewSlug(slug);
  }, []);
  const closeSpot = useCallback(() => {
    setPreviewSlug(null);
    setSheetClosing(false);
    setDismissing(false);
  }, []);
  const handleSavedChange = useCallback((slug: string, saved: boolean) => {
    setSavedSet((prev) => {
      const next = new Set(prev);
      if (saved) next.add(slug);
      else next.delete(slug);
      return next;
    });
  }, []);
  const previewSpot = seasonSpots.find((s) => s.slug === previewSlug) ?? null;

  // Beim Antippen einer Wanderung (Nicht-Pro-Aktivität) deren Route on-demand laden.
  useEffect(() => {
    const slug = previewSlug;
    if (!slug) return;
    const spot = seasonSpots.find((s) => s.slug === slug);
    // An `locked` hängen, nicht an `isPro` – sonst bleibt die Route für zahlende
    // Pro-Kunden aus (getSpotRoute gibt sie ihnen sehr wohl heraus).
    if (!spot || spot.type !== "activity" || spot.locked) return;
    if (slug in routeCache) return; // schon geladen (auch null gecacht)
    let alive = true;
    getSpotRoute(slug).then((coords) => {
      if (alive) setRouteCache((c) => ({ ...c, [slug]: coords }));
    });
    return () => {
      alive = false;
    };
  }, [previewSlug, seasonSpots, routeCache]);

  // Route des aktuell gewählten Spots (falls Wanderung + schon geladen)
  const activeRoute =
    previewSpot && previewSpot.type === "activity" && !previewSpot.locked
      ? (routeCache[previewSpot.slug] ?? null)
      : null;

  // Sanft auf den gewählten Spot fliegen, ihn über die Vorschau-Karte heben.
  // Bei einer Wanderung sofort auf die Routen-Bounding-Box einpassen (kommt mit der
  // Startseiten-Payload -> kein Nachladen, EIN Zoom, kein Umspringen). Die Routen-
  // Linie (activeRoute) lädt weiter lazy und zeichnet sich in den fertigen Ausschnitt.
  const focus =
    previewSpot && previewSpot.lat != null && previewSpot.lng != null
      ? {
          lng: previewSpot.lng,
          lat: previewSpot.lat,
          // Mobile: exakt in den sichtbaren Streifen zwischen Header und Sheet einpassen.
          //  - oben: gemessene Header-Höhe (Notch-sicher) + Rand
          //  - unten: vom Sheet abgedeckter Anteil (SPOT_SHEET_PEEK) + Rand
          // -> Spot/Route sitzen mittig & ausgeglichen, nichts unter Header/Sheet.
          padTop: isDesktop ? 60 : headerH + FIT_GAP,
          padBottom: isDesktop
            ? 470
            : Math.round((vh || 800) * SPOT_SHEET_PEEK) + FIT_GAP,
          bounds: previewSpot.routeBounds ?? undefined,
        }
      : null;

  const labels = useMemo(() => ({ summer: t("summer"), winter: t("winter") }), [t]);

  // Regale = Kategorien, die in dieser Saison wirklich Spots haben. Vorab gefiltert
  // statt beim Rendern übersprungen, damit das ERSTE tatsächlich gerenderte Regal
  // markiert werden kann: An ihm misst das Sheet seine mittlere Stufe.
  const shelves = useMemo(
    () =>
      seasonCats
        .map((cat) => ({
          cat,
          spots: seasonSpots.filter((s) =>
            s.categoryKeys.some((ck) => ck.key === cat.key && ck.season === season),
          ),
        }))
        .filter((shelf) => shelf.spots.length > 0),
    [seasonCats, seasonSpots, season],
  );

  // Gemerkt, weil an diesem Baum ALLE Regale, Karussells und Karten hängen. Ohne das
  // baut ihn jedes Öffnen und Schließen neu auf — das blockiert den Hauptthread lange
  // genug, dass die Karte erst ~180ms nach dem Tippen erfährt, dass sie loslassen soll.
  // Genau die 180ms sieht man als Nachhinken von Route und Pin.
  const panelInner = useMemo(
    () => (
    <>
      <div className="px-4">
        <SeasonToggle value={season} onChange={changeSeason} labels={labels} />
      </div>
      {/* Wassertemperaturen sind bewusst NICHT hier prominent, sondern nur dezent
          im Menü/Header verlinkt (Anton-Entscheidung). */}
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={season}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.32, ease: [0.34, 1.1, 0.64, 1] }}
          className="mt-5 space-y-6"
        >
        {shelves.map(({ cat, spots: catSpots }, i) => {
          return (
            // Das erste Regal ist der Anker für die mittlere Stufe des Sheets
            // (EXPLORE_DETENTS). Nur Markierung, keine Optik.
            <section
              key={`${cat.key}-${cat.season}`}
              data-sg={i === 0 ? "first-shelf" : undefined}
            >
              <h2 className="mb-3 px-4 text-xl font-bold tracking-tight text-ink">
                {cat.title}
              </h2>
              <Carousel>
                {catSpots.map((s) => (
                  <button
                    key={s.slug}
                    type="button"
                    onClick={() => openSpot(s.slug)}
                    className="block text-left transition-transform duration-200 ease-out active:scale-[0.96] md:hover:-translate-y-1"
                  >
                    <SpotCard
                      title={s.title}
                      shortDesc={s.shortDesc}
                      emoji={s.emoji}
                      imageUrl={s.imageUrl}
                      previewUrl={s.previewUrl}
                      isPro={s.isPro}
                      locked={s.locked}
                      lockedLabel={t("lockedLabel")}
                      sizeClassName="w-[76vw] max-w-[300px] md:w-[var(--sg-card)] md:max-w-none"
                    />
                  </button>
                ))}
              </Carousel>
            </section>
          );
        })}
        {shelves.length === 0 && <p className="px-4 text-sm text-muted">{t("empty")}</p>}
        </motion.div>
      </AnimatePresence>
    </>
    ),
    [season, changeSeason, labels, shelves, openSpot, t],
  );

  return (
    <div className="fixed inset-0 z-0 md:top-[var(--sg-header-h)]">
      {/* Karte: mobil vollflächig, Desktop um die Sidebar versetzt */}
      {/* --sg-map-bottom: hebt Mapbox-Logo und -Attribution über das Peek-Sheet und
          die Navigationsleiste. Beide sind Lizenzpflicht und müssen sichtbar bleiben
          (siehe globals.css). Der Wert erbt in die Karte hinein. */}
      <div
        className="absolute inset-0 md:left-[var(--sg-panel)]"
        style={{ "--sg-map-bottom": `calc(var(${SHEET_PEEK_VAR}) + 10px)` } as React.CSSProperties}
      >
        <SpotMap
          markers={markers}
          onMarkerClick={openSpot}
          padding={mapPadding}
          focus={focus}
          // Beim Schließen sofort loslassen: Der Pin geht auf Normalgröße zurück und
          // die Route blendet aus, während das Sheet fährt — nicht danach.
          selectedSlug={dismissing ? null : previewSlug}
          route={dismissing ? null : activeRoute}
          showRouteEnds={false}
          fitRoute={false}
          onMapClick={() => {
            // Mobile: Sheet sanft runtergleiten lassen; Desktop: Karte sofort schließen
            if (isDesktop) {
              closeSpot();
              return;
            }
            // Beide Zustände in EINEM Rendergang. Ginge das Loslassen der Route erst
            // über onDismissStart, bräuchte es einen zweiten Durchlauf: tippen ->
            // rendern -> Effekt -> dismiss() -> setDismissing -> rendern -> Karte.
            // Das Sheet fährt derweil schon (framer-motion läuft an React vorbei), und
            // genau dieser Versatz ist das Nachhinken. So starten beide im selben Frame.
            setSheetClosing(true);
            setDismissing(true);
          }}
        />
      </div>

      {/* Welches Panel sichtbar ist, entscheidet CSS — NICHT JavaScript.
          Der Server kennt die Fensterbreite nicht. Hing das an einem isDesktop-State
          (der zwangsläufig false startet), lieferte er immer das Handy-Sheet aus, der
          Browser malte es, und erst die Hydration tauschte es gegen die Sidebar: am
          Desktop blitzte ein 655px hohes Bottom-Sheet auf. Mit Media-Queries steht
          schon im ERSTEN Bild das Richtige da, auf beiden Geräten, ohne Umbau.
          Der Preis ist der Inhalt zweimal im DOM: gemessen 508 statt 335 Knoten
          (1.52x, +173). Bezahlt wird nur DOM — die Bilder im versteckten Baum laden
          NICHT (nachgemessen: 19 <img> im DOM, 10 geladen), weil lazy-Bilder ohne
          Layout-Box nicht angefordert werden. Das ist es wert: sonst wäre am Desktop
          bis zur Hydration überhaupt nichts zu sehen. MobileSheet misst seine Stufen
          über bodyRef, also im eigenen Teilbaum, und lässt sich vom zweiten Regal im
          DOM nicht durcheinanderbringen.
          ACHTUNG bei vielen Spots: Das Panel rendert JEDEN Spot: bei den geplanten
          100-200 verdoppelt sich hier eine Liste, die dann ohnehin nicht mehr am
          Stück gehören sollte. Wer das angeht, löst beides zusammen. */}
      <aside className="absolute inset-y-0 left-0 z-10 hidden w-[var(--sg-panel)] flex-col border-r border-black/5 bg-cream/95 backdrop-blur-xl md:flex">
        <div className="flex-1 overflow-y-auto py-5">{panelInner}</div>
      </aside>
      {/* `contents`: am Handy darf der Wrapper das Layout nicht anfassen. */}
      <div className="contents md:hidden">
        <MobileSheet hide={previewSpot != null} detents={EXPLORE_DETENTS}>
          {panelInner}
        </MobileSheet>
      </div>

      {/* Spot-Vorschau: Mobile = ziehbares Bottom-Sheet, Desktop = schwebende Karte */}
      {previewSpot &&
        (isDesktop ? (
          <SpotCardDesktop
            spot={previewSpot}
            onClose={closeSpot}
            loggedIn={loggedIn}
            saved={savedSet.has(previewSpot.slug)}
            onSavedChange={handleSavedChange}
          />
        ) : (
          <SpotSheet
            spot={previewSpot}
            closing={sheetClosing}
            onDismissStart={() => setDismissing(true)}
            onClose={closeSpot}
            loggedIn={loggedIn}
            saved={savedSet.has(previewSpot.slug)}
            onSavedChange={handleSavedChange}
          />
        ))}
    </div>
  );
}
