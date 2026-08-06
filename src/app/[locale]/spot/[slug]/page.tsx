import { Suspense } from "react";
import Image from "next/image";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getRelatedSpots, getSpotDetail } from "@/lib/spots";
import { getSavedSlugs } from "@/lib/saved";
import { isLoggedIn } from "@/lib/viewer";
import LockedMedia from "@/components/LockedMedia";
import { buildMapsLink } from "@/lib/maps";
import type { Metadata } from "next";
import ActionTile from "@/components/ActionTile";
import Carousel from "@/components/Carousel";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import LockedSpotCard from "@/components/LockedSpotCard";
import { ProWordmark } from "@/components/ProBadge";
import ProFeatureList from "@/components/ProFeatureList";
import QuickFacts, { type Fact } from "@/components/QuickFacts";
import SaveButton from "@/components/SaveButton";
import SpotCard from "@/components/SpotCard";
import SpotDetailMapLazy from "@/components/SpotDetailMapLazy";
import type { SpotPoi } from "@/components/SpotMap";
import { poiLabelKey } from "@/lib/poi";
import SpotWeather from "@/components/SpotWeather";
import SpotOpeningHours from "@/components/SpotOpeningHours";
import SpotWaterTemp from "@/components/SpotWaterTemp";
import SpotGalleryProvider from "@/components/gallery/SpotGalleryProvider";
import GalleryImage from "@/components/gallery/GalleryImage";
import SpotGallery from "@/components/gallery/SpotGallery";
import SpotVideo from "@/components/SpotVideo";
import StoryMaker from "@/components/StoryMaker";
import { CardSkeleton } from "@/components/skeletons";
import BackButton from "@/components/BackButton";
import {
  factAccess,
  factArea,
  factDifficulty,
  factDuration,
  factDurationFixed,
  factFame,
  factPrice,
  factSeason,
  factSubtype,
} from "@/lib/facts-i18n";
import { alternatesFor, ogFor } from "@/lib/metadata";
import { HERO_BOX } from "./hero-box";
import { breadcrumbLd, spotLd } from "@/lib/jsonld";
import JsonLd from "@/components/JsonLd";
import { routeLengthKm } from "@/lib/geo";

// Einheitlicher Karten-Look (Apple iOS 2026): weiß, weiche Schatten, 18px-Radius.
const CARD =
  "rounded-[18px] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_32px_-20px_rgba(0,0,0,0.28)]";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}): Promise<Metadata> {
  const { locale, slug } = await params;
  const spot = await getSpotDetail(slug, locale);
  if (!spot) return {};

  // Gesperrte Pro-Spots: noindex. Crawler sind immer ausgeloggt und sehen sonst
  // dutzende Seiten mit identischem Titel "SalzGuide Pro" (Duplikat-Signal). Dass
  // ein Pro-Kunde dieselbe URL indexierbar sieht, ist egal: Google crawlt ohne Login.
  // Kein Hero-Foto in die Vorschau: Das Foto ist der Pro-Inhalt (Marken-Standardbild).
  if (spot.locked) {
    return {
      title: "SalzGuide Pro",
      robots: { index: false, follow: true },
      alternates: alternatesFor(locale, `/spot/${slug}`),
      ...ogFor({ locale, path: `/spot/${slug}`, title: "SalzGuide Pro" }),
    };
  }

  // Titel-Muster "Nockstein: Wanderung im Salzburger Land": Spot-Name vorn (Marke der
  // Seite), dahinter Art + Region als Suchbegriff. factSubtype ist bereits in allen
  // 9 Sprachen übersetzt. Lange Spot-Namen bekommen keinen Zusatz, sonst schneidet
  // Google den Titel ab ("%s · SalzGuide" aus dem Layout kommt ja noch dazu).
  const t = await getTranslations({ locale, namespace: "Meta" });
  const kind = spot.subtype ? factSubtype(spot.subtype, locale) : null;
  const title =
    spot.title.length > 35
      ? spot.title
      : kind
        ? t("spotTitle", { title: spot.title, kind })
        : t("spotTitlePlain", { title: spot.title });
  const description = spot.shortDesc ?? t("spotDescriptionFallback", { title: spot.title });
  return {
    title,
    description,
    alternates: alternatesFor(locale, `/spot/${slug}`),
    // Das echte Hero-Foto als Link-Vorschau: bester Klick-Anreiz, keine Extra-Infrastruktur.
    ...ogFor({
      locale,
      path: `/spot/${slug}`,
      title,
      description,
      image: spot.images[0] ?? null,
    }),
  };
}

// Kopfbild der Spot-Seite: Foto (oder Blur-Vorschau bei Pro), Verlauf, Titel, Zurück
// und Speichern. Bewusst auf Modulebene statt in SpotPage: eine Komponente, die im
// Render einer anderen entsteht, gilt bei jedem Durchlauf als neuer Typ
// (react-hooks/static-components). Alles, was sie braucht, kommt über Props.
function Hero({
  spot,
  t,
  locale,
  back,
  isSaved,
  loggedIn,
  children,
}: {
  spot: NonNullable<Awaited<ReturnType<typeof getSpotDetail>>>;
  t: Awaited<ReturnType<typeof getTranslations<"Detail">>>;
  locale: string;
  back: React.ReactNode;
  isSaved: boolean;
  loggedIn: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="relative">
      {spot.locked ? (
        // Gesperrt: nur die Blur-Vorschau – gleiche Darstellung wie Karte, Sheet und
        // Audio-Guide. Das Foto selbst liefert der Server nicht aus.
        <LockedMedia previewUrl={spot.previewUrl} emoji={spot.emoji} eager className={HERO_BOX} />
      ) : !children && spot.images[0] ? (
        <GalleryImage
          index={0}
          zoomable={false}
          src={spot.images[0]}
          alt={spot.title}
          sizes="100vw"
          priority
          className={`block ${HERO_BOX}`}
          imgClassName="object-cover"
          // Oben rechts unter der Merken-Pille: unten überlappt die Fakten-Karte die
          // Hero-Unterkante, und lange Titel füllen die linke Bildhälfte bis zum Rand.
          badgeClassName="absolute right-4 top-[4.5rem] z-10 inline-flex"
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
        {/* Sprach-Switch nur mobil – am Desktop ist er im Header.
            variant="overlay": Er schwebt hier über dem Hero-FOTO, direkt neben dem
            Merken-Knopf. Mit der Standard-Fläche (bg-black/5) war er auf dem Bild kaum zu
            sehen; die weisse Glas-Pille mit Schatten ist dieselbe, die Zurück und Merken
            hier schon tragen. */}
        <span className="md:hidden">
          <LanguageSwitcher variant="overlay" />
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
}

export default async function SpotPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Detail");
  // Pro-Texte aus dem Pro-Namensraum: eine Quelle für alle gesperrten Stellen der App.
  const tPro = await getTranslations("Pro");
  const spot = await getSpotDetail(slug, locale);

  if (!spot) notFound();

  // Projektregel (lib/viewer.ts): Lesen über die lokale JWT-Prüfung statt
  // supabase.auth.getUser() — das war ein Netz-Roundtrip zum Auth-Server bei JEDEM
  // Aufruf der wichtigsten Google-Landeseite.
  const loggedIn = await isLoggedIn();
  const savedSlugs = loggedIn ? await getSavedSlugs() : new Set<string>();
  const isSaved = savedSlugs.has(spot.slug);

  const back = (
    <BackButton
      fallbackHref="/explore"
      label={t("back")}
      className="absolute left-4 top-4"
    />
  );

  // Immer gleich befüllt -> einmal vorbereiten statt an beiden Aufrufstellen wiederholen.
  const heroProps = { spot, t, locale, back, isSaved, loggedIn };

  // Pro-Spot ohne Zugriff -> Paywall (serverseitig gegated).
  //
  // BEWUSST DERSELBE AUFBAU WIE DAS PRO-GATE-SHEET (ProGate.tsx): Wortmarke, ein Satz,
  // dieselben vier Zeilen, Knopf, „einmalig · kein Abo" darunter. Wer eine gesperrte Karte
  // antippt, sieht das Sheet; wer per Link direkt auf der Spot-Seite landet, sieht hier
  // dieselbe Fläche als Seite. Ein Angebot, ein Look — kein zweites Design zum Pflegen.
  if (spot.locked) {
    return (
      <div className="pb-16">
        {/* Hero zeigt bei locked selbst die Blur-Vorschau – kein 🤫 mehr nötig. */}
        <Hero {...heroProps} />
        <div className="mx-auto w-full max-w-[760px] px-4">
          <div className={`${CARD} relative z-10 -mt-9 p-6 text-center`}>
            {/* max-w wie im Sheet: Auf dem 760px-Desktop-Layout bleiben die Zeilen sonst
                so breit, dass die Karte leer wirkt. */}
            <div className="mx-auto max-w-[22rem]">
              <ProWordmark name={tPro("title")} className="text-[17px]" />
              <p className="mt-2 text-[15px] leading-relaxed text-muted">
                {tPro("spotTeaser")}
              </p>
              {/* Liste zentriert als Block, Zeilen selbst linksbündig (w-fit + text-left). */}
              <ProFeatureList density="sheet" className="mx-auto mt-4 w-fit text-left" />
              <Link
                href="/pro"
                className="mt-5 block w-full rounded-full bg-accent px-5 py-4 text-[16px] font-semibold text-white shadow-[0_10px_24px_-10px_rgba(204,41,36,0.55)] transition active:scale-[0.98]"
              >
                {tPro("cta")}
              </Link>
              <p className="mt-2.5 text-[12px] text-muted/80">{tPro("oneTime")}</p>
            </div>
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
    const pr = factPrice(spot.priceLevel);
    if (pr) facts.push({ icon: "💸", label: t("facts.price"), value: pr });
    const ar = factArea(spot.area, locale);
    if (ar) facts.push({ icon: "📍", label: t("facts.area"), value: ar });
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

  // Werte für die Foto-Story als Label + Wert (wie Strava), vorformatiert + lokalisiert, damit
  // die Canvas-Logik nichts über Sprachen wissen muss. Nur vorhandene Werte; Distanz notfalls
  // aus der Route gerechnet.
  const storyStats: { label: string; value: string }[] = [];
  {
    const km = spot.elevation?.distanceKm ?? routeLengthKm(spot.route);
    if (km > 0) {
      storyStats.push({
        label: t("storyMaker.labelDistance"),
        value: `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(km)} km`,
      });
    }
    const asc = spot.elevation?.ascent;
    if (asc != null && asc > 0) {
      storyStats.push({ label: t("elevation.ascent"), value: `${Math.round(asc)} ${t("elevation.unitElevation")}` });
    }
    // Story zeigt einen festen Wert, keinen Bereich ("1–2 Std" -> "2 Std").
    const du = factDurationFixed(spot.duration, locale);
    if (du) storyStats.push({ label: t("facts.duration"), value: du });
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

  // Ähnliche Spots: echte Vorschläge (gleiche Art, geteilte Kategorien, Nähe, Saison)
  // statt „die ersten 8". Das Rechnen und die zwei schlanken Abfragen stehen in
  // lib/spots.ts — hier stand vorher ein getExploreData(), das für acht Karten den
  // kompletten Katalog samt aller Bilder und Übersetzungen geladen hat.
  const related = await getRelatedSpots(spot.slug, locale);

  // Strukturierte Daten: der Spot als schema.org-Objekt + Brotkrumen-Pfad. spotLd()
  // liefert für gesperrte Pro-Spots null (kein Geheimtipp-Leak in die Metadaten).
  const structured = spotLd(spot, locale);
  const tNav = await getTranslations("Nav");

  return (
    <SpotGalleryProvider
      images={spot.images}
      aiOrigins={spot.imageAiOrigins}
      title={spot.title}
    >
    <div className="pb-16">
      {structured && <JsonLd data={structured} />}
      {structured && (
        <JsonLd
          data={breadcrumbLd(locale, [
            { name: "SalzGuide", path: "" },
            { name: tNav("explore"), path: "/explore" },
            { name: spot.title },
          ])}
        />
      )}
      <Hero {...heroProps} />

      <div className="mx-auto w-full max-w-[760px]">
        {/* Inhalt – Quick-Facts überlappen den Hero (schwebende Pille, iOS-2026).
            space-y = EINZIGE Quelle für den Abstand ZWISCHEN den Sektionen. Bewusst
            grosszügig und mit dem Viewport wachsend (40px mobil, 48px ab md), damit die
            Seite aufgeräumt und hochwertig wirkt statt gedrängt. Die „Ähnliche Spots"-
            Sektion unten steht ausserhalb dieses Containers und spiegelt denselben Wert
            (pt-10 md:pt-12), damit der Rhythmus über die ganze Seite gleich bleibt. */}
        <div className="relative z-10 -mt-9 space-y-10 px-4 md:space-y-12">
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

        {/* Karte + (bei Wanderungen) interaktives Höhenprofil + Vollbild-Karte.
            Lazy (SpotDetailMapLazy): Mapbox lädt erst beim Heranscrollen. */}
        {(spot.route || mainPoint) && (
          <SpotDetailMapLazy
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
            subtitle={factSubtype(spot.subtype, locale)}
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

        {/* Story-Section: Foto-Story (eigenes Foto + Routenverlauf drüber) auf JEDER Wanderung
            mit Route; die Video-Story (eigener Clip an die Wander-Animation) zusätzlich, wo ein
            Intro-Video da ist. Steht bewusst NACH den Kurztexten (Dauer/Jahreszeit/Lage) und
            damit einheitlich auf allen Spot-Seiten, nicht direkt am Höhenprofil. */}
        {spot.route && spot.route.length >= 2 && (
          <StoryMaker
            slug={spot.slug}
            route={spot.route}
            stats={storyStats}
            introUrl={spot.introVideoUrl}
            introPosterUrl={spot.introVideoPosterUrl}
          />
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
        // pt spiegelt das space-y der Hauptsektionen (siehe Kommentar oben) -> gleicher
        // Abstand vor „Ähnliche Spots" wie zwischen allen anderen Sektionen.
        <section className="px-4 pt-10 md:pt-12">
          <h2 className="mb-3 px-1 text-[17px] font-semibold text-ink">
            {t("related")}
          </h2>
          <Carousel railPadClass="px-0" scrollPadClass="scroll-px-0">
            {/* An `locked` hängen, nicht an `isPro`: Für einen zahlenden Pro-Kunden
                (oder Admin) sind Pro-Spots normale, anklickbare Karten.
                Gesperrt heißt NICHT tot: Hier stand ein <div> ohne Handler, und der Tipp
                auf einen Geheimtipp – die deutlichste Kaufabsicht der App – lief ins
                Leere. Er öffnet jetzt den Pro-Hinweis (ProGate), dasselbe Sheet, das
                jede gesperrte Stelle der App öffnet. Ein Link ginge hier ohnehin nicht:
                gesperrte Spots haben serverseitig keinen echten Slug. */}
            {related.map((s) =>
              s.locked ? (
                <LockedSpotCard
                  key={s.slug}
                  previewUrl={s.previewUrl}
                  emoji={s.emoji}
                  lockedLabel={t("lockedLabel")}
                  unlockLabel={tPro("cta")}
                />
              ) : (
                <Link key={s.slug} href={`/spot/${s.slug}`} className="block">
                  <SpotCard
                    title={s.title}
                    shortDesc={s.shortDesc}
                    emoji={s.emoji}
                    imageUrl={s.imageUrl}
                    imageAiOrigin={s.imageAiOrigin}
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
