import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getHomeTexts, getHomeMedia } from "@/lib/home-content";
import { alternatesFor } from "@/lib/metadata";
import LandingVideo from "@/components/landing/LandingVideo";
import MediaSlot from "@/components/landing/MediaSlot";
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

  const founders = [
    { name: texts.antonName, body: texts.antonBody, photo: media.antonPhoto },
    { name: texts.simonName, body: texts.simonBody, photo: media.simonPhoto },
  ];

  return (
    <div className="pb-[calc(var(--sg-nav-h)+3rem)] pt-[calc(env(safe-area-inset-top)+7rem)] md:pb-28 md:pt-10">
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
            <div className="rounded-[28px] p-1.5 ring-1 ring-black/[0.05] shadow-[0_2px_4px_rgba(0,0,0,0.04),0_34px_80px_-34px_rgba(0,0,0,0.55)]">
              <LandingVideo
                video={media.explainerVideo}
                hint="Erklär-/Gründervideo 9:16, max. ~2,5 MB, mit Ton"
                playLabel={texts.videoPlay}
              />
            </div>
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
