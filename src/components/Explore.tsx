"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@/i18n/navigation";
import type { ExploreCategory, ExploreSpot } from "@/lib/spots";
import { useAi } from "./ai/AiProvider";
import Carousel from "./Carousel";
import CategoryFilterStrip, {
  isSameFilter,
  type CategoryFilter,
} from "./CategoryFilterStrip";
import SpotCardDesktop from "./SpotCardDesktop";
import SpotSheet, { SPOT_SHEET_PEEK } from "./SpotSheet";
import SeasonPill from "./SeasonPill";
import { naturalSeason, readStoredSeason, writeStoredSeason, type Season } from "@/lib/season";
import SpotCard from "./SpotCard";
import SpotMap, { type MapMarker } from "./SpotMap";
import { useSpotSelection } from "./useSpotSelection";
import { MAP_CTRL_PAD } from "./mapControls";
import MobileSheet, { type Detent } from "./MobileSheet";
import PartnerCredits from "./PartnerCredits";
import { SHEET_PEEK_VAR, useSheetPeek } from "@/lib/sheet-metrics";
import { useScrollMemory } from "@/lib/scroll-memory";
import { useViewportHeight } from "@/lib/viewport";

// Stufen des Explore-Sheets über dem Peek.
//
// Die mittlere ist bewusst KEIN Anteil, sondern am Inhalt gemessen: Sie ist genau so
// hoch, dass das Erste ganz drübersteht – Überschrift, Karussell und darin Titel UND
// Untertitel der Karten. Damit ist die Stufe das, was man dort erwartet: eine Reihe
// zum Durchwischen und Lesen. Als fester Anteil ginge das nicht, weil eine Karte 76vw
// breit ist und ein 4:3-Bild trägt – sie ist auf jedem iPhone unterschiedlich hoch.
//
// „Das Erste" ist je nach Ansicht etwas anderes, deshalb heisst der Anker neutral
// `detent-anchor` und nicht mehr `first-shelf`: ohne Filter das erste REGAL, mit Filter
// die erste KARTE der Liste. Die ganze gefilterte Liste als Anker wäre bei zwölf Spots
// höher als der Bildschirm, und eine Stufe, die an der Decke klebt, ist keine Stufe.
// Der Fallback greift nur, solange gar nichts da ist (leere Saison).
const EXPLORE_DETENTS: Detent[] = [
  { fits: '[data-sg="detent-anchor"]', fallback: 0.5 },
  0.9,
];

// Ruheposition des Sheets: so hoch, dass die Filter-Leiste GANZ dasteht.
//
// Vorher galt hier der globale Peek aus globals.css, und dessen 86px sind von Hand
// gerechnet („Griff 26 + pt-1 4 + Umschalter 40 + Luft 16"). Der Umschalter ist weg, an
// seiner Stelle steht eine Pillen-Leiste, deren Höhe an der Schriftgrösse des Systems
// hängt. Eine feste Zahl beschreibt also Inhalt, der nicht fest ist. Gemessen stimmt sie
// zwangsläufig. Der Fallback ist die ehrliche Schätzung fürs Server-HTML und gilt bis zur
// ersten Messung: Griff 26 + pt-1 4 + Streifen 40 (Pille 32 + 2x4 Luft für Ring und
// Schatten) + 16 Luft. Dass sie bei denselben 86px landet wie der alte Umschalter, ist
// kein Zufall: Beide sind eine Zeile Text mit runder Fassung um sie herum.
const SHEET_PEEK = {
  fits: '[data-sg="filter-strip"]',
  fallback: "calc(86px + var(--sg-nav-h))",
};

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
  const [season, setSeason] = useState<Season>(naturalSeason);
  // Gewählte Kategorie, samt ihrer Saison (der Schlüssel allein ist nicht eindeutig,
  // 'food' gibt es zweimal). BEWUSST NICHT gespeichert: Ein Filter ist eine Absicht für
  // jetzt, keine Einstellung. Wer die Seite neu aufmacht, will die Übersicht sehen und
  // nicht rätseln, warum von 36 Spots nur fünf dastehen.
  const [filter, setFilter] = useState<CategoryFilter | null>(null);
  const [isDesktop, setIsDesktop] = useState(false);
  // Stabile Viewport-Höhe statt window.innerHeight: Das Karten-Padding hängt daran,
  // und innerHeight springt, sobald Safari beim Scrollen seine Leisten einfährt –
  // die Karte hätte dabei mitten in der Geste neu eingepasst (siehe lib/viewport.ts).
  const vh = useViewportHeight();
  // Höhe des überlagernden Mobile-Headers (inkl. Safe-Area/Notch) – gemessen, damit
  // der eingepasste Spot nicht unter den Header rutscht (auf iPhones mit Notch höher).
  const [headerH, setHeaderH] = useState(56);
  const { setOverlayOpen } = useAi();
  // Live-Merkzustand = Quelle der Wahrheit fürs Bookmark der Vorschau. Init aus
  // Server-Daten, in der Session live gehalten -> kein falscher Zustand beim
  // Spot-Wechsel oder nach dem Merken.
  const [savedSet, setSavedSet] = useState<Set<string>>(() => new Set(savedSlugs));
  // Scroll-Gedächtnis der Desktop-Sidebar (das Geschwister von viewKey an der Karte):
  // Zurück von der Spot-Seite steht der Feed wieder so weit unten wie vorher. Nur am
  // Desktop; am Handy gehört das Bottom-Sheet beim Neuaufbau nach oben (der Hook ist
  // dort von selbst inert, siehe scroll-memory.ts).
  const panelScrollRef = useRef<HTMLDivElement>(null);
  useScrollMemory(panelScrollRef, "explore-panel", "y");

  // gespeicherte Saison laden (über eine Microtask-Grenze -> kein synchrones
  // setState im Effekt-Body, verhindert Kaskaden-Renders). readStoredSeason() gibt nur
  // eine Wahl heraus, die noch zur Jahreszeit passt (siehe lib/season.ts).
  useEffect(() => {
    void Promise.resolve().then(() => {
      const s = readStoredSeason();
      if (s) setSeason(s);
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
        : // Rechts steht die Knopf-Säule (Zoom, Zentrieren, Standort), links nichts —
          // deshalb nur rechts der reservierte Rand und links der schmale Sichtrand.
          { top: 120, right: MAP_CTRL_PAD, left: 40, bottom: sheetPeek + FIT_GAP },
    [isDesktop, sheetPeek],
  );

  const seasonSpots = useMemo(
    () => spots.filter((s) => s.seasons.includes(season)),
    [spots, season],
  );
  const seasonCats = useMemo(
    () => categories.filter((c) => c.season === season),
    [categories, season],
  );

  // Die eine gewählte Kategorie, nachgeschlagen. Null, solange „Alle" gilt.
  const activeCat = useMemo(
    () =>
      filter
        ? (categories.find((c) => c.key === filter.key && c.season === filter.season) ??
          null)
        : null,
    [categories, filter],
  );

  // Was der Filter übrig lässt. Ohne Filter ist das die ganze Saison.
  //
  // Beim Filtern wird über `cat.slugs` nachgeschlagen und NICHT selbst gefiltert: Diese
  // Liste kommt fertig sortiert vom Server (explore-ranking.ts, docs/38) und ist genau
  // die Reihenfolge, in der die Kategorie auch als Regal dastünde. Ein eigener Filter
  // hier gäbe eine zweite, stillschweigend andere Reihenfolge.
  const visibleSpots = useMemo(() => {
    if (!activeCat) return seasonSpots;
    const bySlug = new Map(seasonSpots.map((s) => [s.slug, s]));
    return activeCat.slugs
      .map((slug) => bySlug.get(slug))
      .filter((s): s is ExploreSpot => s != null);
  }, [seasonSpots, activeCat]);

  const markers = useMemo<MapMarker[]>(
    () =>
      visibleSpots
        .filter((s) => s.lat != null && s.lng != null)
        .map((s) => ({
          slug: s.slug,
          lat: s.lat as number,
          lng: s.lng as number,
          emoji: s.emoji,
          locked: s.locked,
          title: s.title,
        })),
    [visibleSpots],
  );

  // Welche Pillen es überhaupt gibt: nur Kategorien, die in IHRER Saison wirklich Spots
  // haben. Dieselbe Regel wie bei den Regalen weiter unten, hier nur für beide Saisonen
  // statt für eine. Eine Pille, die auf eine leere Karte führt, wäre eine Sackgasse.
  const chipCategories = useMemo(
    () => categories.filter((c) => c.slugs.length > 0),
    [categories],
  );

  // Auswahl, Route, Kamera und das Zusammenspiel mit dem Sheet kommen aus dem
  // gemeinsamen Haken — dieselbe Quelle, aus der sich die Gespeichert-Karte bedient.
  // Was hier bleibt, ist alles, was die Startseite WIRKLICH auszeichnet: Saison,
  // Regale, Toni, der Desktop-Split.
  const {
    slug: previewSlug,
    spot: previewSpot,
    open: openSpot,
    close: closeSpot,
    route: activeRoute,
    selectedSlug,
    focusFor,
    closing: sheetClosing,
    setClosing: setSheetClosing,
    // `dismissing` selbst braucht die Startseite nicht mehr zu lesen: Der Haken hat
    // Route und hervorgehobenen Pin schon losgelassen, bevor sie danach fragen könnte.
    setDismissing,
  } = useSpotSelection(seasonSpots);

  // ── Saison und Filter: die ganze Entscheidungslogik an EINER Stelle ────────────────
  //
  // Absichtlich hier und nicht in CategoryFilterStrip: Die Leiste weiss, welche Pille
  // angetippt wurde, aber nicht, was das für Karte, Sheet und Vorschau bedeutet. Läge
  // die Regel dort, stünde die Hälfte davon trotzdem wieder hier, und die zwei Hälften
  // liefen beim nächsten Umbau auseinander.
  //
  // `useSpotSelection` läuft weiter auf der UNGEFILTERTEN Saisonliste. Sonst verschwände
  // eine offene Vorschau in dem Moment, in dem ihr Spot aus dem Filter fällt, und zwar
  // ohne Animation: Der Haken fände den Slug nicht mehr, `previewSpot` wäre null, das
  // Sheet verginge mitten in der Bewegung. Stattdessen schliesst es hier ausdrücklich.

  const changeSeason = useCallback(
    (s: Season) => {
      setSeason(s);
      // Der Filter gehört zur alten Saison und ergibt in der neuen keinen Sinn. Ihn
      // stehenzulassen hiesse: Karte wechselt, Pille bleibt dunkel, und was sie jetzt
      // filtert, kann niemand mehr sagen.
      setFilter(null);
      closeSpot();
      writeStoredSeason(s);
    },
    [closeSpot],
  );

  const selectCategory = useCallback(
    (next: CategoryFilter | null) => {
      closeSpot();
      // „Alle": zurück zur Übersicht.
      if (!next) {
        setFilter(null);
        return;
      }
      // Pille aus der anderen Saison: Saison mit umschalten UND filtern. Das ist der
      // ganze Punkt der Fremd-Saison-Pillen — ein Tipp, ein Ergebnis. Deshalb hier
      // nicht changeSeason() aufrufen, das würde den Filter gleich wieder löschen.
      if (next.season !== season) {
        setSeason(next.season);
        setFilter(next);
        writeStoredSeason(next.season);
        return;
      }
      // Dieselbe Pille nochmal: abwählen. Dieselbe Geste wie bei Airbnb und Google Maps.
      setFilter((cur) => (isSameFilter(cur, next) ? null : next));
    },
    [season, closeSpot],
  );

  // Solange eine Spot-Vorschau offen ist, hält Toni seine Sprechblase zurück – beide
  // schweben unten rechts und lägen sonst übereinander.
  useEffect(() => {
    setOverlayOpen(!!previewSlug);
    return () => setOverlayOpen(false); // beim Verlassen der Seite nicht blockiert lassen
  }, [previewSlug, setOverlayOpen]);

  const handleSavedChange = useCallback((slug: string, saved: boolean) => {
    setSavedSet((prev) => {
      const next = new Set(prev);
      if (saved) next.add(slug);
      else next.delete(slug);
      return next;
    });
  }, []);
  // Sanft auf den gewählten Spot fliegen, ihn über die Vorschau-Karte heben.
  // Nur die beiden Ränder sind hier zu Hause: oben der gemessene Header, unten der
  // Anteil, den das Peek-Sheet abdeckt. Wie die Kamera daraus ihr Ziel wählt (fertige
  // Bounding-Box, sonst Linie, sonst Punkt), steht im Haken — und gilt damit auch für
  // die Gespeichert-Karte.
  const focus = focusFor(
    isDesktop ? 60 : headerH + FIT_GAP,
    isDesktop ? 470 : Math.round((vh || 800) * SPOT_SHEET_PEEK) + FIT_GAP,
  );

  const seasonLabels = useMemo(
    () => ({
      summer: t("summer"),
      winter: t("winter"),
      // Der Satz für die ANDERE Saison: Er beschreibt, was der Tipp bewirkt.
      switchTo: season === "summer" ? t("switchToWinter") : t("switchToSummer"),
    }),
    [t, season],
  );
  const stripLabels = useMemo(
    () => ({ all: t("all"), summer: t("summer"), winter: t("winter") }),
    [t],
  );

  // Regale = Kategorien, die in dieser Saison wirklich Spots haben. Vorab gefiltert
  // statt beim Rendern übersprungen, damit das ERSTE tatsächlich gerenderte Regal
  // markiert werden kann: An ihm misst das Sheet seine mittlere Stufe.
  //
  // Die Reihenfolge JE Regal kommt fertig vom Server (cat.slugs, explore-ranking.ts):
  // Stufen + Abwechslungs-Regel, damit derselbe Spot nicht in jedem seiner Regale ganz
  // vorne steht. Hier wird nur noch nachgeschlagen — wer hier wieder selbst sortiert,
  // holt das "Hochkeil zweimal auf Platz 1"-Problem zurück (docs/38).
  const shelves = useMemo(() => {
    const bySlug = new Map(seasonSpots.map((s) => [s.slug, s]));
    return seasonCats
      .map((cat) => ({
        cat,
        spots: cat.slugs
          .map((slug) => bySlug.get(slug))
          .filter((s): s is ExploreSpot => s != null),
      }))
      .filter((shelf) => shelf.spots.length > 0);
  }, [seasonCats, seasonSpots]);

  // Gemerkt, weil an diesem Baum ALLE Regale, Karussells und Karten hängen. Ohne das
  // baut ihn jedes Öffnen und Schließen neu auf — das blockiert den Hauptthread lange
  // genug, dass die Karte erst ~180ms nach dem Tippen erfährt, dass sie loslassen soll.
  // Genau die 180ms sieht man als Nachhinken von Route und Pin.
  const panelInner = useMemo(() => {
    // EINE Stelle, die aus einem Spot eine antippbare Karte macht. Es ist DIESELBE
    // SpotCard wie im Regal, nur einmal auf Karussell-Breite und einmal auf halbe
    // Spaltenbreite gerechnet — die gefilterte Ansicht bringt bewusst KEIN zweites
    // Kartenformat mit, sonst hätte die Seite zwei Handschriften.
    //
    // Entsperrte Karten sind echte Links auf die Spot-Seite: Google folgt ihnen aus dem
    // Server-HTML (vorher fand es Spots fast nur über die Sitemap), und Cmd/Ctrl-Klick
    // öffnet einen neuen Tab. Der normale Klick bleibt App-Gefühl: preventDefault +
    // Sheet, die Adresse ändert sich nicht. Gesperrte Spots behalten den Knopf — ihr
    // slug ist die Tarnung "locked-N" (lib/spots.ts), ein Link liefe ins Leere; das
    // ProGate-Sheet übernimmt.
    const spotCard = (s: ExploreSpot, opts: { eager: boolean; grid: boolean }) => {
      // Sofort laden nur, was beim Aufbau garantiert im Bild steht. Eines davon ist das
      // grösste Bild im ersten Bildschirm (LCP), und eine Reihe erscheint erst, wenn ihr
      // letztes Foto da ist. Alles andere bleibt lazy: Was seitlich hinausragt oder
      // unterhalb liegt, soll das Netz nicht belegen, bevor jemand hinwischt.
      const card = (
        <SpotCard
          title={s.title}
          shortDesc={s.shortDesc}
          emoji={s.emoji}
          imageUrl={s.imageUrl}
          imageAiOrigin={s.imageAiOrigin}
          previewUrl={s.previewUrl}
          isPro={s.isPro}
          locked={s.locked}
          lockedLabel={t("lockedLabel")}
          eager={opts.eager}
          // Im Raster füllt die Karte ihre Spalte; die Spaltenbreite macht das Raster.
          // `sizes` MUSS zur echten Breite passen, sonst holt der Browser eine zu kleine
          // Stufe und das Foto wird weich: eine Spalte ist am iPhone (390 - 32 Rand -
          // 12 Spalte) / 2 = 173px, also gut 45vw.
          sizeClassName={
            opts.grid
              ? "w-full"
              : "w-[76vw] max-w-[300px] md:w-[var(--sg-card)] md:max-w-none"
          }
          sizes={
            opts.grid
              ? "(min-width: 768px) 260px, 45vw"
              : "(min-width: 768px) 220px, 76vw"
          }
        />
      );
      return s.locked ? (
        <button
          key={s.slug}
          type="button"
          onClick={() => openSpot(s.slug)}
          className="cursor-pointer sg-tap-card block w-full text-left"
        >
          {card}
        </button>
      ) : (
        <Link
          key={s.slug}
          href={`/spot/${s.slug}`}
          onClick={(e) => {
            // Neuer Tab (Cmd/Ctrl/Shift/Alt/Mitteltaste): dem Browser überlassen.
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
            e.preventDefault();
            openSpot(s.slug);
          }}
          className="cursor-pointer sg-tap-card block w-full text-left"
        >
          {card}
        </Link>
      );
    };

    return (
    <>
      <CategoryFilterStrip
        categories={chipCategories}
        season={season}
        value={filter}
        onSelect={selectCategory}
        labels={stripLabels}
      />
      {/* Wassertemperaturen sind bewusst NICHT hier prominent, sondern nur dezent
          im Menü/Header verlinkt (Anton-Entscheidung). */}
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          // Der Schlüssel trägt Saison UND Filter: Jeder Wechsel blendet weich um,
          // nicht nur der Saison-Wechsel. Ein harter Schnitt beim Filtern sähe aus
          // wie ein Neuladen, obwohl nur eine Auswahl kleiner wurde.
          key={`${season}:${filter ? `${filter.season}/${filter.key}` : "all"}`}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.32, ease: [0.34, 1.1, 0.64, 1] }}
          // space-y = EINZIGE Quelle für den Abstand ZWISCHEN den Karussell-Regalen.
          // Grosszügig und mit dem Viewport wachsend (40px, ab md 48px), damit die Regale
          // klar als eigene Kategorien lesbar sind statt gedrängt - derselbe Rhythmus wie
          // auf der Spot-Detailseite. Die Überschrift bleibt mit mb-3 bewusst ENG an ihrem
          // eigenen Karussell (Gruppierung: viel Abstand trennt Kategorien, wenig bindet
          // Titel an Inhalt).
          className="mt-5 space-y-10 md:space-y-12"
        >
        {activeCat ? (
          // GEFILTERT: kein Regal, sondern ein RASTER. Ein Regal ist zum Blättern gebaut
          // (eine Karte pro Wisch) — wer gerade eine Kategorie gewählt hat, will aber
          // alles davon überblicken. Volle Breite gestapelt geht dabei nicht: Eine
          // 4:3-Karte ist am iPhone ~370px hoch, es stünde EIN Ergebnis im Bild und
          // „Aussicht & Erholung" mit 24 Spots wären 24 Bildschirme.
          //
          // Zwei Spalten lösen beides: Das Foto bleibt gross genug, um zu wirken (173px
          // am iPhone), und es stehen vier Karten gleichzeitig da. Und es ist DIESELBE
          // SpotCard wie im Regal — die Seite bekommt kein zweites Kartenformat.
          <section>
            {/* KEINE grosse Überschrift: Die aktive Pille steht direkt darüber und sagt
                dasselbe Wort. Was sie NICHT sagt, ist, wie viele es sind — und genau das
                ist beim Filtern die Frage. Deshalb hier nur die Zahl, klein und ruhig. */}
            <p className="mb-3 px-4 text-[13px] font-medium text-muted">
              {t("resultCount", { count: visibleSpots.length })}
            </p>
            {/* gap-y grösser als gap-x: Senkrecht trennt der Abstand ZEILEN des Rasters,
                waagrecht nur zwei Karten nebeneinander. Gleich gross wirkte das Raster
                wie ein Gitter statt wie Karten. */}
            <div className="grid grid-cols-2 gap-x-3 gap-y-6 px-4">
              {visibleSpots.map((s, i) => (
                // Der Anker für die mittlere Stufe ist die ERSTE Karte, nicht das ganze
                // Raster: „hoch genug, dass alles draufpasst" wären bei 24 Spots mehrere
                // Bildschirme, die Stufe klebte an der Decke und wäre keine Stufe mehr.
                <div key={s.slug} data-sg={i === 0 ? "detent-anchor" : undefined}>
                  {spotCard(s, { eager: i < 4, grid: true })}
                </div>
              ))}
            </div>
          </section>
        ) : (
        shelves.map(({ cat, spots: catSpots }, i) => {
          return (
            // Das erste Regal ist der Anker für die mittlere Stufe des Sheets
            // (EXPLORE_DETENTS). Nur Markierung, keine Optik.
            <section
              key={`${cat.key}-${cat.season}`}
              data-sg={i === 0 ? "detent-anchor" : undefined}
            >
              <h2 className="mb-3 px-4 text-xl font-bold tracking-tight text-ink">
                {cat.emoji ? `${cat.emoji} ` : ""}
                {cat.title}
              </h2>
              {/* memoryKey trägt die Saison, damit Sommer- und Winter-Fassung eines
                  Regals sich ihre Blätter-Position getrennt merken. */}
              <Carousel memoryKey={`explore-shelf:${cat.key}-${cat.season}`}>
                {/* Die ersten drei Karten des ERSTEN Regals stehen beim Aufbau immer im
                    Bild (Desktop zeigt 2,5 davon, das Handy 1,3) und laden deshalb
                    sofort. Drei und nicht mehr, siehe spotCard(). */}
                {catSpots.map((s, j) => spotCard(s, { eager: i === 0 && j < 3, grid: false }))}
              </Carousel>
            </section>
          );
        })
        )}
        {!activeCat && shelves.length === 0 && (
          <p className="px-4 text-sm text-muted">{t("empty")}</p>
        )}
        </motion.div>
      </AnimatePresence>
      {/* Partner-Nennung: Pflicht auf jeder Seite (lib/partners.ts). Hier im Panel, weil
          der LegalFooter auf den Vollbild-Karten nicht rendert (lib/routes.ts). Bewusst
          AUSSERHALB der Saison-Animation: Sie soll beim Umschalten nicht mitblenden.
          Kein eigenes pb mehr: den Abschluss-Weissraum bringt der Panel-Scroller mit
          (--sg-page-bottom) — das md:pb-4 hier war ein zweiter, handgerechneter Rest. */}
      <PartnerCredits className="mt-14 px-4" />
    </>
    );
  }, [
    season,
    filter,
    chipCategories,
    selectCategory,
    stripLabels,
    activeCat,
    visibleSpots,
    shelves,
    openSpot,
    t,
  ]);

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
          // Kamera-Gedächtnis: Wer zu einem Spot hinzoomt, seine Seite öffnet und
          // zurückkommt, landet wieder im selben Ausschnitt statt auf der ganz
          // herausgezoomten Übersicht (lib/map-view-memory.ts).
          viewKey="explore"
          // Beim Schließen sofort loslassen: Der Pin geht auf Normalgröße zurück und
          // die Route blendet aus, während das Sheet fährt — nicht danach.
          selectedSlug={selectedSlug}
          route={activeRoute}
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
        {/* Saison-Knopf, links oben AUF der Karte.
            Position rein in CSS, nichts gemessen: `--sg-page-top` ist die bestehende
            Quelle für „unter der Kerbe und unter dem fixen Handy-Header" (globals.css)
            — dieselbe Rechnung, mit der auch die Mapbox-Knöpfe am Handy nach unten
            rücken. Am Desktop liegt schon die ganze Seite unter dem Header, dort reichen
            12px. Hinge das an einem gemessenen Wert, stünde der Knopf im ersten Bild
            falsch und spränge danach.
            z-10: über die Karte, aber unter Sheet (z-45) und Vorschau-Kärtchen. */}
        <div className="pointer-events-none absolute inset-x-3 top-[var(--sg-page-top)] z-10 md:top-3">
          <span className="pointer-events-auto inline-flex">
            <SeasonPill
              season={season}
              onToggle={() => changeSeason(season === "summer" ? "winter" : "summer")}
              labels={seasonLabels}
            />
          </span>
        </div>
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
        {/* pb aus --sg-page-bottom: Das Panel IST auf der Vollbild-Karte das Seitenende
            (die Rechts-Fusszeile rendert hier nicht, lib/routes.ts). Mit dem alten py-5
            endeten die Partner-Logos 16px vor der Unterkante — jede normale Seite hat
            48px. EINE Variable für alle Seitenenden, siehe globals.css. */}
        <div
          ref={panelScrollRef}
          className="flex-1 overflow-y-auto pb-[var(--sg-page-bottom)] pt-5"
        >
          {panelInner}
        </div>
      </aside>
      {/* `contents`: am Handy darf der Wrapper das Layout nicht anfassen. */}
      <div className="contents md:hidden">
        <MobileSheet
          hide={previewSpot != null}
          peek={SHEET_PEEK}
          detents={EXPLORE_DETENTS}
        >
          {panelInner}
        </MobileSheet>
      </div>

      {/* Spot-Vorschau: Mobile = ziehbares Bottom-Sheet, Desktop = schwebende Karte.
          Am Desktop liegt die Karte in AnimatePresence mit dem Slug als key: Öffnen,
          Wechseln (Spot A -> Spot B) und Schliessen laufen so als weiche Überblende statt
          hartem Cut. Mobile hat seine eigene Sheet-Animation (closing/dismissing) und
          bleibt unangetastet. */}
      {isDesktop ? (
        <AnimatePresence>
          {previewSpot && (
            <SpotCardDesktop
              key={previewSpot.slug}
              spot={previewSpot}
              onClose={closeSpot}
              loggedIn={loggedIn}
              saved={savedSet.has(previewSpot.slug)}
              onSavedChange={handleSavedChange}
            />
          )}
        </AnimatePresence>
      ) : (
        previewSpot && (
          <SpotSheet
            spot={previewSpot}
            closing={sheetClosing}
            onDismissStart={() => setDismissing(true)}
            onClose={closeSpot}
            loggedIn={loggedIn}
            saved={savedSet.has(previewSpot.slug)}
            onSavedChange={handleSavedChange}
          />
        )
      )}
    </div>
  );
}
