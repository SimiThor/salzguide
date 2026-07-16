import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/server";
import { getPublishedAreas } from "@/lib/tours";
import TourBuilder from "@/components/tours/TourBuilder";
import BackButton from "@/components/BackButton";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Tours" });
  return { title: t("buildTitle"), description: t("buildLead") };
}

export default async function BuildTourPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "Tours" });

  // Eigene Runden bauen = nur für angemeldete Nutzer. Nicht angemeldet -> Login-Hinweis
  // (kuratierte Runden bleiben ohne Konto testbar).
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return (
      <div className="mx-auto w-full max-w-[640px] px-4 pt-[calc(env(safe-area-inset-top)+1.25rem)] md:pt-6">
        <BackButton fallbackHref="/touren" label={t("backToList")} className="mb-3" />
        <div className="rounded-[18px] bg-white p-8 text-center shadow-sm">
          <div className="text-4xl" aria-hidden>
            🎧
          </div>
          <h1 className="mt-3 text-xl font-bold text-ink">{t("buildNeedLogin")}</h1>
          <p className="mx-auto mt-2 max-w-sm text-[15px] leading-relaxed text-muted">
            {t("buildNeedLoginBody")}
          </p>
          <Link
            href="/profil"
            className="mt-5 inline-block rounded-full bg-accent px-6 py-3 text-sm font-semibold text-white transition active:scale-[0.98]"
          >
            {t("login")}
          </Link>
        </div>
      </div>
    );
  }

  // Nur Gebiete mit gesetztem Startpunkt taugen für eine Runde.
  const areas = (await getPublishedAreas(locale)).filter(
    (a) => a.startLat != null && a.startLng != null,
  );
  return <TourBuilder areas={areas} />;
}
