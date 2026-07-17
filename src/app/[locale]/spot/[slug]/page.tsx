import { Suspense } from "react";
import Image from "next/image";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getExploreData, getSpotDetail, type ExploreSpot } from "@/lib/spots";
import { getSavedSlugs } from "@/lib/saved";
import LockedMedia from "@/components/LockedMedia";
import { createClient } from "@/lib/supabase/server";
import { buildMapsLink } from "@/lib/maps";
import type { Metadata } from "next";
import ActionTile from "@/components/ActionTile";
import Carousel from "@/components/Carousel";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import QuickFacts, { type Fact } from "@/components/QuickFacts";
import SaveButton from "@/components/SaveButton";
import SpotCard from "@/components/SpotCard";
import SpotDetailMap from "@/components/SpotDetailMap";
import type { SpotPoi } from "@/components/SpotMap";
import { poiLabelKey } from "@/lib/poi";
import SpotWeather from "@/components/SpotWeather";
import SpotOpeningHours from "@/components/SpotOpeningHours";
import SpotWaterTemp from "@/components/SpotWaterTemp";
import SpotGalleryProvider from "@/components/gallery/SpotGalleryProvider";
import GalleryImage from "@/components/gallery/GalleryImage";
import SpotGallery from "@/components/gallery/SpotGallery";
import SpotVideo from "@/components/SpotVideo";
import CardSkeleton from "@/components/CardSkeleton";
import BackButton from "@/components/BackButton";
import {
  factAccess,
  factDifficulty,
  factDuration,
  factFame,
  factSeason,
  factSubtype,
} from "@/lib/facts-i18n";

// Einheitlicher Karten-Look (Apple iOS 2026): weiß, weiche Schatten, 18px-Radius.
const CARD =
  "rounded-[18px] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_32px_-20px_rgba(0,0,0,0.28)]";

// Ähnlichkeits-Score für „Ähnliche Spots": gleiche Art (Aktivität/Essen) + geteilte
// Kategorien + geografische Nähe + Saison-Überlappung. Höher = passender.
function similarityScore(self: ExploreSpot | null, c: ExploreSpot): number {
  if (!self) return 0;
  let s = 0;
  if (c.type === self.type) s += 4;
  const selfCats = new Set(self.categoryKeys.map((k) => k.key));
  s += c.categoryKeys.filter((k) => selfCats.has(k.key)).length * 3;
  const selfSeasons = new Set(self.seasons);
  if (c.seasons.some((x) => selfSeasons.has(x))) s += 1;
  if (self.lat != null && self.lng != null && c.lat != null && c.lng != null) {
    const dx = self.lng - c.lng;
    const dy = self.lat - c.lat;
    const dist = Math.sqrt(dx * dx + dy * dy); // grobe Grad-Distanz
    s += Math.max(0, 4 - dist * 20); // Nähe (~<20 km) gibt Bonus
  }
  return s;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}): Promise<Metadata> {
  const { locale, slug } = await params;
  const spot = await getSpotDetail(slug, locale);
  if (!spot) return {};
  return {
    title: spot.locked ? "SalzGuide Pro" : spot.title,
    description: spot.locked ? undefined : (spot.shortDesc ?? undefined),
    alternates: {
      canonical: `/${locale}/spot/${slug}`,
      languages: { de: `/de/spot/${slug}`, en: `/en/spot/${slug}` },
    },
  };
}

export default async function SpotPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Detail");
  const spot = await getSpotDetail(slug, locale);

  if (!spot) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const loggedIn = !!user;
  const savedSlugs = loggedIn ? await getSavedSlugs() : new Set<string>();
  const isSaved = savedSlugs.has(spot.slug);

  const back = (
    <BackButton
      fallbackHref="/explore"
      label={t("back")}
      className="absolute left-4 top-4"
    />
  );

  const HERO_BOX = "h-[42vh] max-h-[460px] min-h-[300px] w-full";
  const Hero = ({ children }: { children?: React.ReactNode }) => (
    <div className="relative">
      {spot.locked ? (
        // Gesperrt: nur die Blur-Vorschau – gleiche Darstellung wie Karte, Sheet und
        // Audio-Guide. Das Foto selbst liefert der Server nicht aus.
        <LockedMedia previewUrl={spot.previewUrl} emoji={spot.emoji} eager className={HERO_BOX} />
      ) : !children && spot.images[0] ? (
        <GalleryImage
          index={0}
          src={spot.images[0]}
          alt={spot.title}
          sizes="100vw"
          priority
          className={`block cursor-zoom-in ${HERO_BOX}`}
          imgClassName="object-cover"
        />
      ) : (
        <div className={`flex ${HERO_BOX} items-center justify-center bg-gradient-to-br from-accent/20 to-muted/20`}>
          <span className="text-[64px] opacity-90" aria-hidden>
            {children ?? spot.emoji ?? "📍"}
          </span>
        </div>
      )}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-3/4 bg-gradient-to-t from-black/70 via-black/25 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 pb-11">
        <div className="mx-auto w-full max-w-[760px] px-4">
          {spot.subtype && !spot.locked && (
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/80">
              {factSubtype(spot.subtype, locale)}
            </p>
          )}
          <h1 className="mt-1 text-[28px] font-bold leading-tight text-white drop-shadow-sm sm:text-[34px]">
            {spot.locked ? t("proTitle") : spot.title}
          </h1>
        </div>
      </div>
      {back}
      <div className="absolute right-4 top-4 flex items-center gap-2">
        {/* Sprach-Switch nur mobil – am Desktop ist er im Header */}
        <span className="md:hidden">
          <LanguageSwitcher />
        </span>
        {!spot.locked && (
          <SaveButton
            label={t("save")}
            slug={spot.slug}
            initialSaved={isSaved}
            loggedIn={loggedIn}
          />
        )}
      </div>
    </div>
  );

  // Pro-Spot ohne Zugriff -> Paywall (serverseitig gegated)
  if (spot.locked) {
    return (
      <div className="pb-16">
        {/* Hero zeigt bei locked selbst die Blur-Vorschau – kein 🤫 mehr nötig. */}
        <Hero />
        <div className="mx-auto w-full max-w-[760px] px-4">
          <div className={`${CARD} relative z-10 -mt-9 flex flex-col items-start gap-4 p-6`}>
            <p className="text-[15px] leading-relaxed text-muted">{t("proTeaser")}</p>
            <Link
              href="/pro"
              className="rounded-full bg-accent px-5 py-3 text-sm font-semibold text-white active:scale-[0.98]"
            >
              {t("unlock")}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Quick-Facts (4, typabhängig). Werte werden sprachabhängig übersetzt (facts-i18n).
  const facts: Fact[] = [];
  if (spot.type === "food") {
    const st = factSubtype(spot.subtype, locale);
    if (st) facts.push({ icon: "🍽️", label: t("facts.type"), value: st });
    if (spot.priceLevel) facts.push({ icon: "💸", label: t("facts.price"), value: spot.priceLevel });
    if (spot.area) facts.push({ icon: "📍", label: t("facts.area"), value: spot.area });
    const fm = factFame(spot.fame, locale);
    if (fm) facts.push({ icon: "⭐", label: t("facts.fame"), value: fm });
  } else {
    const du = factDuration(spot.duration, locale);
    if (du) facts.push({ icon: "⏱️", label: t("facts.duration"), value: du });
    const df = factDifficulty(spot.difficulty, locale);
    if (df) facts.push({ icon: "🥾", label: t("facts.difficulty"), value: df });
    const se = factSeason(spot.bestSeason, locale);
    if (se) facts.push({ icon: "🌤️", label: t("facts.season"), value: se });
    const ac = factAccess(spot.access, locale);
    if (ac) facts.push({ icon: "🚌", label: t("facts.access"), value: ac });
  }

  // Haupt-/Anreisepunkt: bei einer Wanderung der Startpunkt, sonst der Spot-Punkt.
  const mainPoint: readonly [number, number] | null =
    spot.lat != null && spot.lng != null
      ? [spot.lat, spot.lng]
      : spot.route && spot.route.length > 0
        ? [spot.route[0][1], spot.route[0][0]]
        : null;
  // Auto -> Parkplatz (falls vorhanden), sonst Hauptpunkt. Öffis -> immer Hauptpunkt
  // (Google Maps führt den Fußweg von der Haltestelle automatisch mit).
  const carDest =
    spot.parkingLat != null && spot.parkingLng != null
      ? ([spot.parkingLat, spot.parkingLng] as const)
      : mainPoint;
  const transitDest = mainPoint;

  // Zusatzpunkte für die Karte: Wasserstellen, Hütten und (als Pin) der Parkplatz.
  // Bei gesperrten Pro-Spots sind waterStops/huts serverseitig leer -> kein Leak.
  // Das Gattungs-Label ("Trinkbrunnen" …) wird HIER in der Sprache des Nutzers berechnet
  // (t("poi.<key>")), der freie Name bleibt sprachneutral.
  const poiLabel = (kind: "water" | "hut" | "parking", subtype?: string) =>
    t(`poi.${poiLabelKey(kind, subtype)}`);
  const mapPois: SpotPoi[] = [
    ...spot.waterStops.map((p) => ({ ...p, kind: "water" as const, label: poiLabel("water", p.subtype) })),
    ...spot.huts.map((p) => ({ ...p, kind: "hut" as const, label: poiLabel("hut", p.subtype) })),
    ...(spot.parkingLat != null && spot.parkingLng != null
      ? [{ lng: spot.parkingLng, lat: spot.parkingLat, kind: "parking" as const, label: poiLabel("parking") }]
      : []),
  ];

  // Anfahrts-Modi anhand des Zugangs-Felds: „auto" -> kein Öffi-Button, „oeffis" ->
  // kein Auto-Button; „beides"/leer -> beide. Damit keine irreführende/leere Anzeige.
  const showCar = spot.access !== "oeffis" && carDest != null;
  const showBus = spot.access !== "auto" && transitDest != null;
  // Anzahl aller Action-Kacheln -> bei nur EINER wird sie volle Breite (nicht halb-leer).
  const actionCount =
    Number(showCar) +
    Number(showBus) +
    Number(!!spot.phone) +
    Number(!!spot.websiteUrl) +
    Number(!!spot.ticketUrl);

  // Kurztexte
  const blocks: { heading: string; text: string }[] = [];
  if (spot.sectionA)
    blocks.push({
      heading: spot.type === "food" ? t("headFoodA") : t("headActivityA"),
      text: spot.sectionA,
    });
  if (spot.sectionB)
    blocks.push({
      heading: spot.type === "food" ? t("headFoodB") : t("headActivityB"),
      text: spot.sectionB,
    });
  if (spot.locationText)
    blocks.push({ heading: t("headLocation"), text: spot.locationText });

  const { spots: all } = await getExploreData(locale);
  // Ähnliche Spots: nach Ähnlichkeit zum aktuellen Spot sortieren (echte Vorschläge
  // statt „erste 8"). Der aktuelle Spot steckt selbst in `all` -> als Referenz nutzen.
  const self = all.find((s) => s.slug === spot.slug) ?? null;
  const related = all
    .filter((s) => s.slug !== spot.slug)
    .map((s) => ({ s, score: similarityScore(self, s) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map((x) => x.s);

  return (
    <SpotGalleryProvider images={spot.images} title={spot.title}>
    <div className="pb-16">
      <Hero />

      <div className="mx-auto w-full max-w-[760px]">
        {/* Inhalt – Quick-Facts überlappen den Hero (schwebende Pille, iOS-2026) */}
        <div className="relative z-10 -mt-9 space-y-8 px-4">
          <QuickFacts facts={facts} />

        {spot.general && (
          <section className={`${CARD} p-5`}>
            <h2 className="mb-2 text-[17px] font-semibold text-ink">
              {t("headGeneral")}
            </h2>
            <p className="text-[15px] leading-relaxed text-muted">{spot.general}</p>
          </section>
        )}

        {/* Galerie – weitere Fotos (adaptiv, klick zum Vergrößern) */}
        <SpotGallery images={spot.images} />

        {spot.insiderTip && (
          <section className={`${CARD} p-5`}>
            <h2 className="mb-3 text-[17px] font-semibold text-ink">
              {t("headInsider")}
            </h2>
            {(spot.localName || spot.insiderAuthor) && (
              <div className="mb-3 flex items-center gap-3">
                {spot.localAvatar ? (
                  <Image
                    src={spot.localAvatar}
                    alt={spot.localName ?? ""}
                    width={40}
                    height={40}
                    sizes="40px"
                    className="h-10 w-10 rounded-full object-cover"
                  />
                ) : (
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/15 text-sm font-semibold text-accent">
                    {(spot.localName ?? spot.insiderAuthor ?? "?")
                      .trim()
                      .charAt(0)
                      .toUpperCase()}
                  </span>
                )}
                <div className="leading-tight">
                  <p className="text-sm font-semibold text-ink">
                    {spot.localName ?? spot.insiderAuthor}
                  </p>
                  {spot.localRole && (
                    <p className="text-xs text-muted">{spot.localRole}</p>
                  )}
                </div>
              </div>
            )}
            <p className="text-[15px] leading-relaxed text-muted">{spot.insiderTip}</p>
          </section>
        )}

        {/* Öffnungszeiten – Google Places (gecacht) oder manuell; streamt via Suspense */}
        {spot.hasOpeningHours && (
          <Suspense
            fallback={<CardSkeleton lines={4} />}
          >
            <SpotOpeningHours spot={spot} locale={locale} />
          </Suspense>
        )}

        {/* Karte + (bei Wanderungen) interaktives Höhenprofil + Vollbild-Karte */}
        {(spot.route || mainPoint) && (
          <SpotDetailMap
            route={spot.route}
            elevation={spot.elevation}
            marker={
              spot.route || !mainPoint
                ? null
                : {
                    lat: mainPoint[0],
                    lng: mainPoint[1],
                    emoji: spot.emoji,
                    title: spot.title,
                    slug: spot.slug,
                  }
            }
            poi={mapPois}
            center={mainPoint ? [mainPoint[1], mainPoint[0]] : undefined}
            title={spot.title}
          />
        )}

        {/* Anfahrt + Action-Tiles. Nur eine Kachel -> volle Breite (nicht halb-leer). */}
        <div className={`grid gap-3 ${actionCount > 1 ? "sm:grid-cols-2" : ""}`}>
          {showCar && carDest && (
            <ActionTile
              href={buildMapsLink(carDest[0], carDest[1], "driving")}
              icon="🚗"
              label={t("byCar")}
              sub={t("byCarSub")}
            />
          )}
          {showBus && transitDest && (
            <ActionTile
              href={buildMapsLink(transitDest[0], transitDest[1], "transit")}
              icon="🚌"
              label={t("byTransit")}
              sub={t("byTransitSub")}
            />
          )}
          {spot.phone && (
            <ActionTile
              href={`tel:${spot.phone.replace(/[^0-9+]/g, "")}`}
              icon="📞"
              label={t("call")}
              newTab={false}
            />
          )}
          {spot.websiteUrl && (
            <ActionTile href={spot.websiteUrl} icon="🌐" label={t("website")} />
          )}
          {spot.ticketUrl && (
            <ActionTile
              href={spot.ticketUrl}
              icon="🎟️"
              label={t("tickets")}
              sub={spot.ticketPartner ?? undefined}
              ad={t("ad")}
            />
          )}
        </div>

        {/* Kurztexte als gruppierte Karte */}
        {blocks.length > 0 && (
          <div className={`${CARD} divide-y divide-black/[0.06] overflow-hidden`}>
            {blocks.map((b, i) => (
              <div key={i} className="p-5">
                <h2 className="mb-2 text-[17px] font-semibold text-ink">
                  {b.heading}
                </h2>
                <p className="text-[15px] leading-relaxed text-muted">{b.text}</p>
              </div>
            ))}
          </div>
        )}

        {/* 9:16-Video (ohne Titel) – im Guide-Flow zwischen den Kurztexten (Dauer/Jahreszeit/
            Lage) und Wetter/Wassertemperatur. Nur wenn vorhanden. */}
        {spot.videoUrl && (
          <SpotVideo src={spot.videoUrl} poster={spot.videoPosterUrl} label={t("playVideo")} />
        )}

        {/* Wassertemperatur (Seen-/Bade-Spots mit lake_name) – streamt via Suspense */}
        {spot.lakeName && (
          <Suspense
            fallback={<CardSkeleton lines={3} />}
          >
            <SpotWaterTemp lakeName={spot.lakeName} locale={locale} />
          </Suspense>
        )}

        {/* Wetter (nur Aktiv-Spots) – 7-Tage-Vorschau, streamt via Suspense.
            Bewusst weit unten (direkt vor „Ähnliche Spots"): nettes Extra, nicht das Wichtigste. */}
        {spot.type === "activity" && mainPoint && (
          <Suspense
            fallback={<CardSkeleton lines={4} />}
          >
            <SpotWeather
              lat={mainPoint[0]}
              lon={mainPoint[1]}
              locale={locale}
              title={t("weather.title")}
              today={t("weather.today")}
            />
          </Suspense>
        )}
      </div>

      {/* Ähnliche Spots – exakt in Sektionsbreite (px-4 wie die anderen Sektionen); das
          Karussell läuft innerhalb dieser Breite und ragt nicht rechts heraus. */}
      {related.length > 0 && (
        <section className="px-4 pt-8">
          <h2 className="mb-3 px-1 text-[17px] font-semibold text-ink">
            {t("related")}
          </h2>
          <Carousel railPadClass="px-0" scrollPadClass="scroll-px-0">
            {/* An `locked` hängen, nicht an `isPro`: Für einen zahlenden Pro-Kunden
                (oder Admin) sind Pro-Spots normale, anklickbare Karten. */}
            {related.map((s) =>
              s.locked ? (
                <div key={s.slug}>
                  <SpotCard
                    title={s.title}
                    shortDesc={s.shortDesc}
                    emoji={s.emoji}
                    imageUrl={s.imageUrl}
                    previewUrl={s.previewUrl}
                    isPro
                    locked
                    lockedLabel={t("lockedLabel")}
                  />
                </div>
              ) : (
                <Link key={s.slug} href={`/spot/${s.slug}`} className="block">
                  <SpotCard
                    title={s.title}
                    shortDesc={s.shortDesc}
                    emoji={s.emoji}
                    imageUrl={s.imageUrl}
                  />
                </Link>
              ),
            )}
          </Carousel>
        </section>
      )}
      </div>
    </div>
    </SpotGalleryProvider>
  );
}
