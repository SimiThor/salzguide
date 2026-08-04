import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getHomeTexts, getHomeMedia, explainerVideoFor } from "@/lib/home-content";
import { alternatesFor, ogFor } from "@/lib/metadata";
import LandingVideo from "@/components/landing/LandingVideo";
import MediaSlot from "@/components/landing/MediaSlot";
import SocialSection from "@/components/landing/SocialSection";
import { getSocialPosts } from "@/lib/social-feed";
import { CTA_PRIMARY } from "@/components/landing/cta";

// „Über uns". Eine normale APP-Seite (App-Header + Burger + Tab-Leiste, wie Explore), KEINE
// Marketing-Kopie der Startseite. Inhalt = nur der Über-uns-Teil (die Gründer Anton & Simon
// + das Video), gefüttert aus derselben Quelle (home_content) -> ein Text, zwei Orte.
//
// Eigenes, „catchy" Layout im Apple/Airbnb-Stil: Split-Hero (grosse Aussage + Hochkant-
// Video), zwei warme Gesichter als Karten, warmer Abschluss. Viel Weissraum, grosse Typo.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const [t, texts] = await Promise.all([
    getTranslations({ locale, namespace: "Meta" }),
    getHomeTexts(locale),
  ]);
  // Beschreibung bleibt der echte Gründer-Text aus der DB (foundersBody): authentisch,
  // vom Admin pflegbar und in jeder Sprache vorhanden. Nur der Titel kommt aus Meta.
  return {
    title: t("aboutTitle"),
    description: texts.foundersBody,
    alternates: alternatesFor(locale, "/ueber-uns"),
    ...ogFor({
      locale,
      path: "/ueber-uns",
      title: t("aboutTitle"),
      description: texts.foundersBody,
    }),
  };
}

export default async function AboutPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const [texts, media, socialPosts] = await Promise.all([
    getHomeTexts(locale),
    getHomeMedia(),
    getSocialPosts(),
  ]);

  const founders = [
    { name: texts.antonName, body: texts.antonBody, photo: media.antonPhoto },
    { name: texts.simonName, body: texts.simonBody, photo: media.simonPhoto },
  ];

  return (
    // +40px: Diese Seite beginnt mit einem Titel-Block und trägt bewusst mehr Luft als die
    // Listen-Seiten. Der Sockel kommt trotzdem aus der einen Quelle (--sg-page-top), damit
    // der Titel nicht hinter dem Header landet, wenn der Header mal wächst.
    // Kein eigenes pb: Den Platz über der Tab-Leiste bringt die Rechts-Fusszeile für ALLE
    // Seiten mit (LegalFooter, pb aus --sg-nav-h) — ein zweites Polster hier stapelte sich
    // nur zu einer doppelten Leerfläche vor dem Footer.
    <div className="pt-[calc(var(--sg-page-top)+40px)] md:pt-10">
      <div className="mx-auto w-full max-w-[1040px] px-5 md:px-8">
        {/* ── HERO ─── Split am Desktop (Aussage links, Hochkant-Video rechts), gestapelt
            und zentriert am Handy. Das Video ist das Gründervideo (mit Ton, lädt erst beim
            Antippen); fehlt es, steht hier der Platzhalter im richtigen Format. */}
        <section className="grid items-center gap-12 md:grid-cols-[1.12fr_0.88fr] md:gap-14">
          <div className="text-center md:text-left">
            <p className="text-[13px] font-semibold uppercase tracking-[0.16em] text-accent">
              {texts.foundersEyebrow}
            </p>
            <h1 className="mt-3 text-balance text-[40px] font-bold leading-[1.01] tracking-tight text-ink md:text-[62px]">
              {texts.foundersTitle}
            </h1>
            <p className="mx-auto mt-5 max-w-[34ch] text-balance text-[18px] leading-relaxed text-muted md:mx-0 md:text-[22px]">
              {texts.foundersBody}
            </p>
          </div>

          <div className="mx-auto w-full max-w-[270px] md:max-w-[320px]">
            <LandingVideo
              video={explainerVideoFor(media, locale)}
              hint="Erklär-/Gründervideo 9:16, max. ~2,5 MB, mit Ton"
              playLabel={texts.videoPlay}
            />
          </div>
        </section>

        {/* ── DIE ZWEI DAHINTER ─── Zwei warme Gesichter, IMMER nebeneinander (auch am
            Handy, dort kompakter), Airbnb-Muster: Foto oben, Name + Text darunter. */}
        <section className="mt-20 md:mt-28">
          <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:gap-x-10 sm:gap-y-12">
            {founders.map((f, i) => (
              <div key={i}>
                <div className="aspect-[4/5] w-full transform-gpu isolate overflow-hidden rounded-[18px] bg-black/[0.04] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_20px_44px_-28px_rgba(0,0,0,0.5)] sm:rounded-[24px]">
                  <MediaSlot
                    image={f.photo}
                    hint={f.name}
                    sizes="(min-width: 640px) 460px, 45vw"
                    className="h-full w-full object-cover"
                  />
                </div>
                <h2 className="mt-3 text-[17px] font-bold tracking-tight text-ink sm:mt-5 sm:text-[23px]">
                  {f.name}
                </h2>
                <p className="mt-1 text-[13px] leading-relaxed text-muted sm:mt-2 sm:text-[16px]">
                  {f.body}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* ── INSTAGRAM ─── Direkt nach den zwei Gesichtern, und hier ist das die richtige
            Stelle (anders als auf der Startseite, wo Toni dazwischen steht): Wer gerade
            gelesen hat, WER wir sind, will als nächstes sehen, WAS wir machen. Dasselbe
            Bauteil und dieselbe Quelle wie dort.
            Der -mx-5/-mx-8 hebt den Seitenrand dieser Seite auf, und die Section bekommt ihn
            als padClass zurück: So schneidet die letzte Kachel am Bildschirmrand an (der
            Hinweis zum Wischen), während Überschrift und erste Kachel exakt unter dem Text
            darüber stehen. Ohne die zwei Props stünde die Section auf ihrem Startseiten-Rand
            (px-6) und damit 4px daneben. */}
        {/* Die Abfrage steht hier ein zweites Mal (die Section blendet sich auch selbst aus),
            und zwar wegen des Abstands: Ein leerer Rahmen mit mt-6 würde den Abschluss um
            genau diesen Betrag nach oben ziehen. So sitzt er richtig, ob mit Feed oder ohne. */}
        {socialPosts.length > 0 && (
          <div className="-mx-5 mt-20 md:-mx-8 md:mt-28">
            <SocialSection
              texts={texts}
              posts={socialPosts}
              padClass="px-5 md:px-8"
              scrollPadClass="scroll-px-5 md:scroll-px-8"
              // py-0: Den Abstand geben hier die Nachbarn (mt-20 md:mt-28), wie bei jedem
              // anderen Block dieser Seite. Siehe yClass in SocialSection.
              yClass="py-0"
            />
          </div>
        )}

        {/* ── ABSCHLUSS ─── Nicht noch ein Argument, sondern der Weg zur Karte. Alles andere
            (Touren, Events, Profil …) erreicht man über Menü/Tab-Leiste dieser App-Seite. */}
        <section className="mt-20 md:mt-28">
          <div className="mx-auto max-w-[640px] overflow-hidden rounded-[30px] bg-gradient-to-b from-white to-accent/[0.07] px-6 py-11 text-center ring-1 ring-black/[0.05] md:py-14">
            <h2 className="mx-auto max-w-[18ch] text-balance text-[27px] font-bold leading-[1.1] tracking-tight text-ink md:text-[36px]">
              {texts.finalTitle}
            </h2>
            <Link href="/explore" className={`mt-7 inline-block ${CTA_PRIMARY}`}>
              {texts.heroCta}
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}
