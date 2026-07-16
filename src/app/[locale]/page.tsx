import { setRequestLocale } from "next-intl/server";
import { getExploreData } from "@/lib/spots";
import { getSavedSlugs } from "@/lib/saved";
import { createClient } from "@/lib/supabase/server";
import Explore from "@/components/Explore";

// Explore = Startseite (map-first). Daten serverseitig laden, Client-Komponente rendern.
export default async function HomePage({
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
