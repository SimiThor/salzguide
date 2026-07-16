import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getExploreData } from "@/lib/spots";
import { getSavedSlugs } from "@/lib/saved";
import { createClient } from "@/lib/supabase/server";
import { alternatesFor } from "@/lib/metadata";
import Explore from "@/components/Explore";

// Die Entdecken-Karte (map-first). Lag bis 07/2026 auf „/" — dort liegt jetzt die
// Startseite, die das Produkt erklärt. Daten serverseitig laden, Client-Komponente rendern.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Meta" });
  return {
    title: t("exploreTitle"),
    description: t("exploreDescription"),
    alternates: alternatesFor(locale, "/explore"),
  };
}

export default async function ExplorePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { spots, categories } = await getExploreData(locale);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const savedSlugs = user ? [...(await getSavedSlugs())] : [];

  return (
    <Explore
      spots={spots}
      categories={categories}
      savedSlugs={savedSlugs}
      loggedIn={!!user}
    />
  );
}
