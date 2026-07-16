import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getSpotCount } from "@/lib/spots";
import { alternatesFor } from "@/lib/metadata";
import LandingNav from "@/components/landing/LandingNav";
import Hero from "@/components/landing/Hero";
import TrustStrip from "@/components/landing/TrustStrip";
import FeaturedSpots from "@/components/landing/FeaturedSpots";
import Story from "@/components/landing/Story";
import ToniSection from "@/components/landing/ToniSection";
import FoundersSection from "@/components/landing/FoundersSection";
import ProSection from "@/components/landing/ProSection";
import { CTA_PRIMARY } from "@/components/landing/cta";

// Die Startseite. Erklärt SalzGuide für Leute, die es noch nicht kennen, und führt sie auf
// EINEN Weg: /explore. Bis 07/2026 lag hier die Karte, die konnte zwar bedient werden,
// erklärte aber weder Produkt noch Nutzen noch, wer dahintersteht.
//
// Sie trägt bewusst keine App-Navigation (siehe lib/routes.ts) und bringt ihre eigene,
// reduzierte Leiste mit.
//
// Die EINE Aussage, die jede Section trägt: Anton war an jedem Platz selbst, und unsere KI
// kennt nur diese Plätze. Das ist der Unterschied zu Google Maps (kennt alles, war nirgends)
// und zu ChatGPT (rät). Alles, was diese Aussage nicht stützt, gehört nicht auf die Seite.
//
// Roter Faden: Was ist das und wieso nicht Google? (Hero) -> Wem glaubst du? (TrustStrip)
// -> Wie schaut das aus? (FeaturedSpots) -> Wieso nicht ChatGPT? (Story) -> Wer ist „wir"?
// (Founders) -> Was kann seine KI? (Toni) -> Was kostet es? (Pro) -> Los. (Schluss-CTA)
//
// Founders steht VOR Toni, und das ist Absicht: Tonis Glaubwürdigkeit kommt von den
// Menschen, nicht umgekehrt. „Jeder Platz, den Toni dir zeigt, hat Anton selbst gesehen"
// trägt nur, wenn Anton kurz davor ein Gesicht bekommen hat.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Meta" });
  return {
    // absolute: „SalzGuide · SalzGuide" wäre das Ergebnis des Titel-Templates aus dem Layout.
    title: { absolute: t("homeTitle") },
    description: t("homeDescription"),
    alternates: alternatesFor(locale, ""),
  };
}

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "Home" });

  // Live aus der DB: ab 10 Spots auf Zehner abgerundet („60+"), darunter exakt („8").
  // Wächst ohne manuelle Pflege mit — hier ist NIE eine Zahl einzutragen.
  const spotCount = await getSpotCount();

  return (
    <>
      <LandingNav />
      <Hero locale={locale} />
      <TrustStrip locale={locale} spotCount={spotCount} />
      {/* Echte Plätze, bevor irgendetwas erklärt wird. Auswahl im Admin unter
          Einstellungen; ohne Auswahl blendet sich die Section selbst aus. */}
      <FeaturedSpots locale={locale} />
      <Story locale={locale} />
      <FoundersSection locale={locale} />
      <ToniSection locale={locale} />
      <ProSection locale={locale} />

      {/* Schluss-CTA: wer bis hier gelesen hat, ist überzeugt — nicht noch ein Argument,
          sondern der Weg raus. */}
      <section className="px-6 pb-16 pt-4 text-center md:pb-20">
        <h2 className="mx-auto max-w-[18ch] text-balance text-[30px] font-bold leading-[1.15] tracking-tight text-ink md:text-[40px]">
          {t("finalTitle")}
        </h2>
        <Link
          href="/explore"
          className={`mt-7 inline-block w-full max-w-[320px] text-center md:w-auto ${CTA_PRIMARY}`}
        >
          {t("heroCta")}
        </Link>
      </section>
    </>
  );
}
