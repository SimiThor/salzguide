import { getTranslations, setRequestLocale } from "next-intl/server";
import { getPublishedSpots } from "@/lib/spots";
import Carousel from "@/components/Carousel";
import SpotCard from "@/components/SpotCard";
import SheetDemo from "@/components/SheetDemo";

// Demo-Seite für Auftrag C: zeigt SpotCards im Karussell + ziehbares Bottom-Sheet.
// Daten kommen echt aus Supabase (testet die DB-Anbindung end-to-end).
export default async function DemoPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Demo");
  const spots = await getPublishedSpots(locale);

  return (
    <div className="flex flex-1 flex-col gap-6 py-6">
      <header className="px-4">
        <h1 className="text-2xl font-bold text-ink">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted">{t("subtitle")}</p>
      </header>

      <section className="flex flex-col gap-2">
        <h2 className="px-4 text-sm font-semibold tracking-wide text-muted uppercase">
          {t("carousel")}
        </h2>
        <Carousel>
          {spots.map((spot) => (
            <SpotCard
              key={spot.slug}
              title={spot.title}
              shortDesc={spot.shortDesc}
              emoji={spot.emoji}
              isPro={spot.isPro}
              locked={spot.isPro} // simuliert: ausgeloggt -> Pro gesperrt
              lockedLabel={t("lockedLabel")}
            />
          ))}
        </Carousel>
      </section>

      <section className="px-4">
        <SheetDemo
          buttonLabel={t("openSheet")}
          sheetTitle={t("sheetTitle")}
          sheetBody={t("sheetBody")}
        />
      </section>
    </div>
  );
}
