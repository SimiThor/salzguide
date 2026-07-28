import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/server";
import { getPublishedAreas } from "@/lib/tours";
import { viewerCanSeePro } from "@/lib/spots";
import { alternatesFor } from "@/lib/metadata";
import TourBuilder from "@/components/tours/TourBuilder";
import BackButton from "@/components/BackButton";
import AiSparkle from "@/components/ai/AiSparkle";
import { ProWordmark } from "@/components/ProBadge";
import ProFeatureList from "@/components/ProFeatureList";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Tours" });
  return {
    title: t("buildTitle"),
    description: t("buildLead"),
    alternates: alternatesFor(locale, "/touren/bauen"),
  };
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

  // Eigene Runden bauen ist Pro (Begründung in tour-generate.ts: jede Generierung
  // kostet Claude + Mapbox). Nicht-Pro sieht hier die Kauf-Fläche, BEWUSST im selben
  // Aufbau wie das Pro-Gate-Sheet und die gesperrte Spot-Seite: Wortmarke, ein Satz,
  // dieselben Zeilen, Knopf, „einmalig · kein Abo". Ein Angebot, ein Look. Das Sparkle
  // oben spielt die Rolle der Blur-Vorschau beim Spot: Es zeigt, WAS hier gesperrt ist.
  const canSeePro = await viewerCanSeePro();
  if (!canSeePro) {
    const tPro = await getTranslations({ locale, namespace: "Pro" });
    return (
      <div className="mx-auto w-full max-w-[640px] px-4 pt-[calc(env(safe-area-inset-top)+1.25rem)] md:pt-6">
        <BackButton fallbackHref="/touren" label={t("backToList")} className="mb-3" />
        <div className="rounded-[18px] bg-white p-6 text-center shadow-sm">
          <div className="mx-auto max-w-[22rem]">
            <AiSparkle gradient className="mx-auto h-9 w-9" />
            <h1 className="mt-3">
              <ProWordmark name={tPro("title")} className="text-[17px]" />
            </h1>
            <p className="mt-2 text-[15px] leading-relaxed text-muted">
              {t("buildProTeaser")}
            </p>
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
    );
  }

  // Nur Gebiete mit gesetztem Startpunkt taugen für eine Runde.
  const areas = (await getPublishedAreas(locale)).filter(
    (a) => a.startLat != null && a.startLng != null,
  );
  return <TourBuilder areas={areas} />;
}
