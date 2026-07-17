import { setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import AdminNav from "@/components/admin/AdminNav";
import HomeContentManager from "@/components/admin/HomeContentManager";
import HomeMediaManager from "@/components/admin/HomeMediaManager";
import HomeFeaturedManager from "@/components/admin/HomeFeaturedManager";
import { getHomeContentAdmin, getHomeFeaturedAdmin } from "@/lib/admin";

// Alles, was auf „/" steht, an einem Ort: Texte, Bilder, Spots.
//
// Warum eine eigene Seite und nicht drei Blöcke in den Einstellungen: Die Startseite bringt
// 40 Textfelder, vier Medien-Slots und die Spot-Auswahl mit. In den Einstellungen wären
// Toni-Avatar, Locals und Kategorien darunter ausser Sichtweite gescrollt, und die
// Einstellungen wären de facto die Startseiten-Seite mit Anhang gewesen.
//
// Der Zugriff hängt am Admin-Layout (Rollen-Guard) — dieselbe Tür wie für alle
// Admin-Seiten, hier wird sie nicht nochmal eigens gebaut.
export const dynamic = "force-dynamic";

export default async function AdminHomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [homeContent, homeSpots] = await Promise.all([
    getHomeContentAdmin(),
    getHomeFeaturedAdmin(),
  ]);

  return (
    <div className="space-y-4 pb-12">
      <AdminNav active="settings" />
      <div>
        <Link
          href="/admin/settings"
          className="text-[13px] font-semibold text-muted transition hover:text-ink"
        >
          ← Einstellungen
        </Link>
        <h1 className="mt-1 text-2xl font-bold text-ink">Startseite</h1>
        <p className="mt-1 text-[13px] text-muted">
          Texte, Bilder und Spots auf salzguide.com. Deutsch ist die Quelle, der Rest wird
          daraus übersetzt.
        </p>
      </div>

      {/* Reihenfolge = Arbeitsreihenfolge: erst schreiben, dann bebildern, dann die Spots
          auswählen, auf die die Texte verweisen. */}
      <HomeContentManager {...homeContent} />
      <HomeMediaManager media={homeContent.media} />
      <HomeFeaturedManager {...homeSpots} />
    </div>
  );
}
