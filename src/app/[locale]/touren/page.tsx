import type { Metadata } from "next";
import Image from "next/image";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getPublishedTours } from "@/lib/tours";
import { listUserTours } from "@/lib/user-tours";
import { viewerCanSeePro } from "@/lib/spots";
import { alternatesFor, ogFor } from "@/lib/metadata";
import SavedRoutesList from "@/components/tours/SavedRoutesList";
import BuildTourCard from "@/components/tours/BuildTourCard";

const CARD =
  "rounded-[18px] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_32px_-20px_rgba(0,0,0,0.28)]";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  // SEO-Texte aus dem Meta-Namensraum, die sichtbare Überschrift bleibt Tours.title.
  const t = await getTranslations({ locale, namespace: "Meta" });
  return {
    title: t("tourenTitle"),
    description: t("tourenDescription"),
    alternates: alternatesFor(locale, "/touren"),
    ...ogFor({
      locale,
      path: "/touren",
      title: t("tourenTitle"),
      description: t("tourenDescription"),
    }),
  };
}

export default async function ToursPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "Tours" });
  const [tours, mine, canSeePro] = await Promise.all([
    getPublishedTours(locale),
    listUserTours(locale),
    viewerCanSeePro(),
  ]);
  // listUserTours liefert null, wenn nicht angemeldet -> zuverlässiges Login-Signal
  // ohne zweiten Auth-Roundtrip.
  const loggedIn = mine !== null;

  return (
    <div className="mx-auto w-full max-w-[760px] px-4 pt-[var(--sg-page-top)] md:pt-6">
      <h1 className="text-2xl font-bold text-ink">{t("title")}</h1>
      <p className="mt-1 text-[15px] leading-relaxed text-muted">{t("subtitle")}</p>

      {/* Einstieg in den KI-Runden-Builder. Mit Pro -> Builder; Gast und Nicht-Pro
          bekommen ERST das passende Sheet (Login- bzw. Pro-Gate) statt eines Sprungs
          auf eine andere Seite – Aufteilung und Begründung in BuildTourCard.tsx.
          Smart-AI-Look wie im Rest der App: helle Karte (Familie mit den Runden-Karten
          darunter), das KI-Signal steckt im warmen Sparkle-Chip, nicht in einer lauten
          Fläche. Der laute rote KI-Verlauf (.sg-ai-btn) bleibt dem „generiert gerade"-
          Moment im Builder vorbehalten. */}
      <BuildTourCard loggedIn={loggedIn} canSeePro={canSeePro} className={CARD} />

      {/* Deine gemerkten Runden (nur eingeloggt & vorhanden) */}
      {mine && mine.length > 0 && <SavedRoutesList routes={mine} title={t("yourRoutes")} />}

      {tours.length > 0 && mine && mine.length > 0 && (
        <h2 className="mt-8 mb-3 text-[13px] font-semibold uppercase tracking-wide text-muted">
          {t("curatedRoutes")}
        </h2>
      )}

      {tours.length === 0 ? (
        <div className={`${CARD} mt-8 p-8 text-center`}>
          <p className="text-[15px] leading-relaxed text-muted">{t("listEmpty")}</p>
        </div>
      ) : (
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          {tours.map((tour, i) => (
            <Link
              key={tour.slug}
              href={`/touren/${tour.slug}`}
              className={`${CARD} block overflow-hidden transition active:scale-[0.99]`}
            >
              {tour.coverUrl ? (
                <div className="relative h-40 w-full overflow-hidden">
                  <Image
                    src={tour.coverUrl}
                    alt=""
                    fill
                    sizes="(min-width: 640px) 380px, 100vw"
                    quality={62}
                    // Die ersten Cover sind das LCP dieser Seite -> sofort laden.
                    priority={i < 2}
                    className="object-cover"
                  />
                </div>
              ) : (
                <div className="flex h-40 w-full items-center justify-center bg-accent/5 text-5xl">
                  {tour.emoji ?? "🎧"}
                </div>
              )}
              <div className="p-4">
                <h2 className="text-[17px] font-bold text-ink">{tour.title}</h2>
                {tour.subtitle && (
                  <p className="mt-1 line-clamp-2 text-[14px] leading-relaxed text-muted">
                    {tour.subtitle}
                  </p>
                )}
                {/* Ruhige Meta-Zeile statt Pillen-Reihe – dasselbe Muster wie
                    SavedRouteCard, damit beide Kartentypen EIN System sind. Bewusst
                    OHNE Pro-Kennzeichnung: Die ersten Stopps jeder Runde sind gratis
                    anhörbar, ein Pro-Etikett an der Kachel würde nur abschrecken,
                    bevor jemand überhaupt reingehört hat. Den Pro-Moment erklärt die
                    Tour-Seite selbst am ersten gesperrten Stopp. */}
                <p className="mt-2.5 text-[13px] text-muted">
                  {[
                    t("stops", { count: tour.stopCount }),
                    tour.durationMin != null ? t("minutes", { count: tour.durationMin }) : null,
                    tour.distanceKm != null ? `${tour.distanceKm} km` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
