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
import MobileSheet, { MOBILE_SHEET_PEEK } from "./MobileSheet";

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
  const [vh, setVh] = useState(0);
  // Höhe des überlagernden Mobile-Headers (inkl. Safe-Area/Notch) – gemessen, damit
  // der eingepasste Spot nicht unter den Header rutscht (auf iPhones mit Notch höher).
  const [headerH, setHeaderH] = useState(56);
  const [previewSlug, setPreviewSlug] = useState<string | null>(null);
  const [sheetClosing, setSheetClosing] = useState(false);
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

  // Desktop/Mobile erkennen + Viewport-Höhe messen
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const u = () => {
      setIsDesktop(mq.matches);
      setVh(window.innerHeight);
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

  // fitBounds-Padding (damit Marker nicht verdeckt werden):
  // - Desktop: Sidebar ist per md:left-[380px] ausgespart; unten extra Platz für die
  //   Glas-Navleiste (~76px) + Puffer.
  // - Mobile: unten viel Platz fürs Peek-Sheet (~18% vh, deckt auch die Navleiste ab).
  const mapPadding = useMemo(
    () =>
      isDesktop
        ? { top: 70, right: 70, left: 70, bottom: 70 }
        : { top: 120, right: 40, left: 40, bottom: Math.round((vh || 800) * MOBILE_SHEET_PEEK) + 48 },
    [isDesktop, vh],
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

  const onMarkerClick = useCallback((slug: string) => {
    setSheetClosing(false);
    setPreviewSlug(slug);
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

  const labels = { summer: t("summer"), winter: t("winter") };

  const hasAny = seasonCats.some((cat) =>
    seasonSpots.some((s) =>
      s.categoryKeys.some((ck) => ck.key === cat.key && ck.season === season),
    ),
  );

  const panelInner = (
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
        {seasonCats.map((cat) => {
          const catSpots = seasonSpots.filter((s) =>
            s.categoryKeys.some((ck) => ck.key === cat.key && ck.season === season),
          );
          if (catSpots.length === 0) return null;
          return (
            <section key={`${cat.key}-${cat.season}`}>
              <h2 className="mb-3 px-4 text-xl font-bold tracking-tight text-ink">
                {cat.title}
              </h2>
              <Carousel>
                {catSpots.map((s) => (
                  <button
                    key={s.slug}
                    type="button"
                    onClick={() => setPreviewSlug(s.slug)}
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
        {!hasAny && <p className="px-4 text-sm text-muted">{t("empty")}</p>}
        </motion.div>
      </AnimatePresence>
    </>
  );

  return (
    <div className="fixed inset-0 z-0 md:top-14">
      {/* Karte: mobil vollflächig, Desktop um die Sidebar versetzt */}
      {/* --sg-map-bottom: hebt Mapbox-Logo und -Attribution über das Peek-Sheet und
          die Navigationsleiste. Beide sind Lizenzpflicht und müssen sichtbar bleiben
          (siehe globals.css). Der Wert erbt in die Karte hinein. */}
      <div
        className="absolute inset-0 md:left-[var(--sg-panel)]"
        style={{ "--sg-map-bottom": `calc(${MOBILE_SHEET_PEEK * 100}vh + 10px)` } as React.CSSProperties}
      >
        <SpotMap
          markers={markers}
          onMarkerClick={onMarkerClick}
          padding={mapPadding}
          focus={focus}
          selectedSlug={previewSlug}
          route={activeRoute}
          showRouteEnds={false}
          fitRoute={false}
          onMapClick={() => {
            // Mobile: Sheet sanft runtergleiten lassen; Desktop: Karte sofort schließen
            if (isDesktop) setPreviewSlug(null);
            else setSheetClosing(true);
          }}
        />
      </div>

      {isDesktop ? (
        <aside className="absolute inset-y-0 left-0 z-10 flex w-[var(--sg-panel)] flex-col border-r border-black/5 bg-cream/95 backdrop-blur-xl">
          <div className="flex-1 overflow-y-auto py-5">{panelInner}</div>
        </aside>
      ) : (
        <MobileSheet hide={previewSpot != null}>{panelInner}</MobileSheet>
      )}

      {/* Spot-Vorschau: Mobile = ziehbares Bottom-Sheet, Desktop = schwebende Karte */}
      {previewSpot &&
        (isDesktop ? (
          <SpotCardDesktop
            spot={previewSpot}
            onClose={() => setPreviewSlug(null)}
            loggedIn={loggedIn}
            saved={savedSet.has(previewSpot.slug)}
            onSavedChange={handleSavedChange}
          />
        ) : (
          <SpotSheet
            spot={previewSpot}
            closing={sheetClosing}
            onClose={() => {
              setPreviewSlug(null);
              setSheetClosing(false);
            }}
            loggedIn={loggedIn}
            saved={savedSet.has(previewSpot.slug)}
            onSavedChange={handleSavedChange}
          />
        ))}
    </div>
  );
}
