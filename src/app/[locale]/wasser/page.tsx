import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { LAKES } from "@/lib/lakes";
import { getWaterMaps, lookupLake, getLakeSpots } from "@/lib/water-temp";
import { alternatesFor } from "@/lib/metadata";
import WaterExplore, { type LakeTemp } from "@/components/WaterExplore";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Water" });
  return {
    title: t("title"),
    description: t("subtitle"),
    alternates: alternatesFor(locale, "/wasser"),
  };
}

export default async function WaterPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "Water" });

  const [maps, lakeSpots] = await Promise.all([
    getWaterMaps(),
    getLakeSpots(locale),
  ]);
  const now = Date.now();
  // Nur Seen mit AKTUELLER Messung (<= 7 Tage, via lookupLake) aufnehmen -> die
  // Übersicht (Liste + Karte) zeigt ausschliesslich verlässliche, aktuelle Werte.
  const lakes: LakeTemp[] = [];
  for (const l of LAKES) {
    const r = lookupLake(maps, l, now);
    if (!r) continue;
    lakes.push({
      slug: l.slug,
      name: l.name,
      lat: l.lat,
      lng: l.lng,
      tempC: r.tempC,
      at: r.at,
      source: r.source,
      spots: lakeSpots[l.slug] ?? [],
    });
  }

  return (
    <WaterExplore
      lakes={lakes}
      locale={locale}
      labels={{
        title: t("title"),
        subtitle: t("subtitle"),
        noData: t("noData"),
        asOf: t("asOf"),
        salzburg: "Land Salzburg",
        ages: "AGES",
        attribution: t("attribution"),
      }}
    />
  );
}
