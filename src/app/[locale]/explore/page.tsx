import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getExploreData } from "@/lib/spots";
import { getSavedSlugs } from "@/lib/saved";
import { isLoggedIn } from "@/lib/viewer";
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
  // Katalog und Merkliste parallel: Die Merkliste hing vorher HINTER der Karten-Abfrage,
  // obwohl sie nichts von ihr braucht — die beiden Wartezeiten addierten sich.
  //
  // getSavedSlugs() prüft selbst, ob jemand angemeldet ist (und gibt sonst eine leere Menge
  // zurück), deshalb steht hier keine eigene Auth-Abfrage mehr. currentUserId() ist per
  // React-cache() ohnehin dieselbe Antwort wie die in getSavedSlugs und viewerCanSeePro:
  // ein Aufruf pro Request statt drei Netz-Roundtrips (siehe lib/viewer.ts).
  const [{ spots, categories }, saved, loggedIn] = await Promise.all([
    getExploreData(locale),
    getSavedSlugs(),
    isLoggedIn(),
  ]);

  return (
    <Explore
      spots={spots}
      categories={categories}
      savedSlugs={[...saved]}
      loggedIn={loggedIn}
    />
  );
}
