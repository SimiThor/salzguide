import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getHomeTexts, getHomeMedia } from "@/lib/home-content";
import { alternatesFor } from "@/lib/metadata";
import LandingVideo from "@/components/landing/LandingVideo";
import MediaSlot from "@/components/landing/MediaSlot";
import { CTA_PRIMARY } from "@/components/landing/cta";

// „Über uns". Eine ganz normale APP-Seite (App-Header + Burger + Tab-Leiste, wie Explore) -
// KEINE Marketing-Kopie der Startseite: Wer hier landet, ist schon in der App und soll von
// hier weiter zur Karte und zu den anderen Seiten kommen, nicht in den Verkaufs-Pitch.
//
// Inhalt = nur der ÜBER-UNS-TEIL der Startseite (die Gründer Anton & Simon), gefüttert aus
// derselben Quelle (home_content). Wer im Admin die Gründer-Texte der Startseite pflegt,
// pflegt damit automatisch auch diese Seite - ein Text, zwei Orte. Bewusst NICHT die
// restlichen Startseiten-Sektionen (Story, Kacheln), damit die Seite kein Klon ist, sondern
// im schlichten App-Layout steht.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const [t, texts] = await Promise.all([
    getTranslations({ locale, namespace: "Menu" }),
    getHomeTexts(locale),
  ]);
  return {
    title: { absolute: `${t("about")} · SalzGuide` },
    description: texts.foundersBody,
    alternates: alternatesFor(locale, "/ueber-uns"),
  };
}

export default async function AboutPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const [texts, media] = await Promise.all([getHomeTexts(locale), getHomeMedia()]);

  return (
    // App-Seiten-Rahmen: oben Platz für den fixen Mobile-Header (Safe-Area + Headerhöhe),
    // unten Platz für die Tab-Leiste; am Desktop schlanker, weil AppChrome dort schon oben
    // Platz lässt. Gleiches Muster wie die anderen App-Inhaltsseiten (z.B. Events).
    <div className="mx-auto w-full max-w-[760px] px-4 pt-[calc(env(safe-area-inset-top)+4.5rem)] pb-[calc(var(--sg-nav-h)+2.5rem)] md:pb-16 md:pt-8">
      <p className="text-[13px] font-semibold uppercase tracking-wider text-accent">
        {texts.foundersEyebrow}
      </p>
      <h1 className="mt-2 text-balance text-[30px] font-bold leading-[1.12] tracking-tight text-ink md:text-[40px]">
        {texts.foundersTitle}
      </h1>
      <p className="mt-4 max-w-[62ch] text-balance text-[16px] leading-relaxed text-muted md:text-[18px]">
        {texts.foundersBody}
      </p>

      {/* Gründer-/Erklärvideo (mit Ton) - volle Breite am Handy, begrenzt am Desktop. */}
      <div className="mx-auto mt-8 w-full max-w-[320px] md:mx-0">
        <LandingVideo
          video={media.explainerVideo}
          hint="Erklär-/Gründervideo 9:16, max. ~2,5 MB, mit Ton"
          playLabel={texts.videoPlay}
        />
      </div>

      {/* Anton & Simon, je als eigene Karte - zwei echte Gesichter sind der Vertrauens-Hebel. */}
      <div className="mt-10 space-y-4">
        {(["anton", "simon"] as const).map((who) => (
          <div
            key={who}
            className="flex items-start gap-4 rounded-[18px] bg-white p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_32px_-24px_rgba(0,0,0,0.3)] ring-1 ring-black/[0.04]"
          >
            <div className="h-14 w-14 shrink-0 transform-gpu isolate overflow-hidden rounded-full">
              <MediaSlot
                image={media[`${who}Photo`]}
                hint=""
                sizes="56px"
                className="h-full w-full object-cover"
              />
            </div>
            <div>
              <p className="text-[16px] font-semibold text-ink">{texts[`${who}Name`]}</p>
              <p className="mt-0.5 text-[14px] leading-relaxed text-muted">
                {texts[`${who}Body`]}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* Weiter in die App: der Weg zur Karte. Alles andere (Touren, Events, Profil …)
          erreicht man über das Menü/die Tab-Leiste, die diese App-Seite mitbringt. */}
      <div className="mt-10">
        <Link href="/explore" className={`inline-block ${CTA_PRIMARY}`}>
          {texts.heroCta}
        </Link>
      </div>
    </div>
  );
}
