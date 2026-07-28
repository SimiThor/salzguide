import type { Metadata } from "next";
import Image from "next/image";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getPublishedTours } from "@/lib/tours";
import { listUserTours } from "@/lib/user-tours";
import { alternatesFor, ogFor } from "@/lib/metadata";
import SavedRoutesList from "@/components/tours/SavedRoutesList";
import AiSparkle from "@/components/ai/AiSparkle";
import { STATUS_ACCENT, STATUS_GOOD, STATUS_NEUTRAL } from "@/lib/ui";

const CARD =
  "rounded-[18px] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_32px_-20px_rgba(0,0,0,0.28)]";
// Status, kein Knopf: umrandet statt gefüllt (siehe lib/ui.ts).
const PILL = STATUS_NEUTRAL;

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
  const [tours, mine] = await Promise.all([
    getPublishedTours(locale),
    listUserTours(locale),
  ]);
  // listUserTours liefert null, wenn nicht angemeldet -> zuverlässiges Login-Signal
  // ohne zweiten Auth-Roundtrip.
  const loggedIn = mine !== null;

  return (
    <div className="mx-auto w-full max-w-[760px] px-4 pt-[var(--sg-page-top)] md:pt-6">
      <h1 className="text-2xl font-bold text-ink">{t("title")}</h1>
      <p className="mt-1 text-[15px] leading-relaxed text-muted">{t("subtitle")}</p>

      {/* Einstieg in den KI-Runden-Builder. Angemeldet -> Builder; sonst -> Login-Hinweis
          (nicht angemeldete Nutzer können nur kuratierte Runden testen).
          Smart-AI-Look wie im Rest der App: helle Karte (Familie mit den Runden-Karten
          darunter), das KI-Signal steckt im warmen Sparkle-Chip, nicht in einer lauten
          Fläche. Der laute rote KI-Verlauf (.sg-ai-btn) bleibt dem „generiert gerade"-
          Moment im Builder vorbehalten. */}
      <Link
        href={loggedIn ? "/touren/bauen" : "/profil"}
        className={`${CARD} mt-5 flex items-center gap-3 px-4 py-3.5 ring-1 ring-black/[0.05] transition active:scale-[0.99]`}
      >
        <AiSparkle gradient className="h-[26px] w-[26px] shrink-0" />
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold text-ink">{t("buildCard")}</span>
          <span className="block text-[13px] leading-snug text-muted">
            {loggedIn ? t("buildCardSub") : t("buildNeedLogin")}
          </span>
        </span>
        <span className="shrink-0 text-[17px] text-muted/50" aria-hidden>
          ›
        </span>
      </Link>

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
                <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px] text-muted">
                  <span className={PILL}>{t("stops", { count: tour.stopCount })}</span>
                  {tour.durationMin != null && (
                    <span className={PILL}>{t("minutes", { count: tour.durationMin })}</span>
                  )}
                  {tour.distanceKm != null && (
                    <span className={PILL}>{tour.distanceKm} km</span>
                  )}
                  <span className={PILL} title={t("modeToggle")} aria-hidden>
                    🎧 · 📖
                  </span>
                  {tour.isPro ? (
                    <span className={STATUS_ACCENT}>
                      {t("proTag")}
                    </span>
                  ) : (
                    <span className={STATUS_GOOD}>
                      {t("freeTag")}
                    </span>
                  )}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
