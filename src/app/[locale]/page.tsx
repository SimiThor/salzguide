import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getSpotCount } from "@/lib/spots";
import { getHomeTexts, getHomeMedia } from "@/lib/home-content";
import { alternatesFor, ogFor } from "@/lib/metadata";
import { organizationLd, webSiteLd } from "@/lib/jsonld";
import JsonLd from "@/components/JsonLd";
import LandingNav from "@/components/landing/LandingNav";
import Hero from "@/components/landing/Hero";
import TrustStrip from "@/components/landing/TrustStrip";
import FeaturedSpots from "@/components/landing/FeaturedSpots";
import Story from "@/components/landing/Story";
import ToniSection from "@/components/landing/ToniSection";
import FoundersSection from "@/components/landing/FoundersSection";
import ProSection from "@/components/landing/ProSection";
import SocialSection from "@/components/landing/SocialSection";
import { getSocialPosts } from "@/lib/social-feed";
import { CTA_PRIMARY } from "@/components/landing/cta";
import { LANDING_SECTION_Y } from "@/components/landing/layout";

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
    ...ogFor({
      locale,
      path: "",
      title: t("homeTitle"),
      description: t("homeDescription"),
    }),
  };
}

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  // Texte und Medien kommen aus der DB (home_content), NICHT mehr über next-intl. Die Seite
  // holt sie EINMAL und reicht sie durch, statt dass jede Section selbst fragt: So ist es
  // ein Lesevorgang statt acht, und die Sections bleiben dumme Darstellung.
  // Fällt die DB aus oder ist ein Feld leer, greift messages/de.json (siehe home-content.ts).
  const [texts, media, spotCount, socialPosts] = await Promise.all([
    getHomeTexts(locale),
    getHomeMedia(),
    // Live aus der DB: ab 10 Spots auf Zehner abgerundet („60+"), darunter exakt („8").
    // Wächst ohne manuelle Pflege mit, hier ist NIE eine Zahl einzutragen.
    getSpotCount(),
    // Die Instagram-Kacheln. Eine Tabellen-Abfrage, kein Aufruf bei Meta: Die Bilder liegen
    // in unserem eigenen Speicher (im Admin gepflegt), damit diese Seite vorgerendert werden
    // kann und kein Besucher auf Instagram wartet.
    getSocialPosts(),
  ]);

  return (
    <>
      {/* Strukturierte Daten: Wer wir sind + was die Seite ist. Nur hier auf der
          Startseite — Google erwartet Organization/WebSite einmal, nicht auf jeder Seite. */}
      <JsonLd data={organizationLd()} />
      <JsonLd data={webSiteLd(locale)} />
      <LandingNav ctaLabel={texts.navCta} />
      <Hero texts={texts} media={media} />
      <TrustStrip texts={texts} spotCount={spotCount} />
      {/* Echte Spots, bevor irgendetwas erklärt wird. Auswahl im Admin unter
          Einstellungen; ohne Auswahl blendet sich die Section selbst aus. */}
      <FeaturedSpots texts={texts} locale={locale} />
      <Story texts={texts} />
      <FoundersSection texts={texts} media={media} locale={locale} />
      <ToniSection texts={texts} />
      <ProSection texts={texts} locale={locale} />

      {/* Instagram, bewusst NACH Pro und VOR dem Schluss: Wer bis hier gelesen hat, ist
          entweder überzeugt (dann kommt gleich der Weg zur Karte) oder noch nicht (dann ist
          Folgen der leichtere zweite Schritt, und wir sehen uns wieder). Der rote Faden
          Gründer -> Toni bleibt dabei unangetastet: Tonis Glaubwürdigkeit kommt von den zwei
          Gesichtern direkt davor, dazwischen gehört nichts.
          Ohne gespiegelte Beiträge blendet sich die Section selbst aus. */}
      <SocialSection texts={texts} posts={socialPosts} />

      {/* Schluss-CTA: wer bis hier gelesen hat, ist überzeugt — nicht noch ein Argument,
          sondern der Weg raus.
          Trägt denselben Abstand wie jede andere Section (LANDING_SECTION_Y). Hier stand
          pt-4: Der Block hing damit nur 72px unter seinem Vorgänger, während jede andere
          Naht der Seite 128px hatte. Das las sich nicht als „gehört zusammen", sondern als
          Fehler, und zwar genau an der Stelle, an der die Seite ihre Wirkung hat. */}
      <section className={`px-6 text-center ${LANDING_SECTION_Y}`}>
        <h2 className="mx-auto max-w-[18ch] text-balance text-[30px] font-bold leading-[1.15] tracking-tight text-ink md:text-[40px]">
          {texts.finalTitle}
        </h2>
        <Link
          href="/explore"
          className={`mt-7 inline-block w-full max-w-[320px] text-center md:w-auto ${CTA_PRIMARY}`}
        >
          {texts.heroCta}
        </Link>
      </section>
    </>
  );
}
