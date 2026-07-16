import type { Metadata } from "next";
import Image from "next/image";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getPublishedTours } from "@/lib/tours";
import { listUserTours } from "@/lib/user-tours";
import SavedRoutesList from "@/components/tours/SavedRoutesList";

const CARD =
  "rounded-[18px] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_32px_-20px_rgba(0,0,0,0.28)]";
const PILL = "rounded-full bg-black/[0.06] px-2.5 py-1 font-medium";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Tours" });
  return { title: t("title"), description: t("subtitle") };
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
    <div className="mx-auto w-full max-w-[760px] px-4 pt-[calc(env(safe-area-inset-top)+4.5rem)] md:pt-6">
      <h1 className="text-2xl font-bold text-ink">{t("title")}</h1>
      <p className="mt-1 text-[15px] leading-relaxed text-muted">{t("subtitle")}</p>

      {/* Einstieg in den KI-Runden-Builder. Angemeldet -> Builder; sonst -> Login-Hinweis
          (nicht angemeldete Nutzer können nur kuratierte Runden testen). */}
      <Link
        href={loggedIn ? "/touren/bauen" : "/profil"}
        className="mt-5 flex items-center justify-between gap-3 rounded-[18px] bg-ink px-5 py-4 text-white transition active:scale-[0.99]"
      >
        <span>
          <span className="block text-[15px] font-semibold">{t("buildCard")}</span>
          <span className="block text-[12px] text-white/70">
            {loggedIn ? t("buildCardSub") : t("buildNeedLogin")}
          </span>
        </span>
        <span className="text-[18px]" aria-hidden>
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
          {tours.map((tour) => (
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
                    <span className="rounded-full bg-accent/10 px-2.5 py-1 font-semibold text-accent">
                      {t("proTag")}
                    </span>
                  ) : (
                    <span className="rounded-full bg-green-600/10 px-2.5 py-1 font-semibold text-green-700">
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
