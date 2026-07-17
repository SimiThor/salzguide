import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getProPrice, formatProPrice } from "@/lib/pro";
import { PRO_FEATURES } from "@/components/proFeatures";
import type { HomeTexts } from "@/lib/home-fields";
import { ProWordmark } from "@/components/ProBadge";
import { CTA_PRIMARY } from "./cta";

// Pro auf der Startseite: das Angebot benennen, aber NICHT hier verkaufen. Der Kauf lebt
// auf /pro, wo die §-18-FAGG-Zustimmung, der Login-Fluss und der Stripe-Checkout
// zusammenhängen. Ein zweiter Kauf-Weg daneben wäre eine zweite Stelle, an der Recht und
// Zahlung auseinanderlaufen können.
//
// DESIGN: Diese Fläche ist die von ProLanding.tsx (/pro), Klasse für Klasse. Nicht
// „ähnlich", sondern gleich: Breite 440, rounded-[28px], derselbe Verlauf, derselbe rote
// Schatten, derselbe Ring. Wer von hier auf /pro klickt, soll dieselbe Fläche wiedersehen.
// Hier stand vorher eine eigene Variante (max-w-[560px], eigene Schriftgrössen) und ein
// selbstgebauter „SALZGUIDE PRO"-Eyebrow. Genau davor warnt ProBadge.tsx: es ist
// „PLATTFORMWEIT die EINZIGE Quelle für den Pro-Look". Ein zweiter Pro-Look ist kein
// Detail, sondern der Moment, in dem das Produkt aussieht wie zwei Produkte.
//
// Preis kommt LIVE aus Stripe (lib/pro.ts), nie hier hinschreiben. Anzeige == Zahlung.
// Vorteile kommen aus PRO_FEATURES, der einen Quelle, die auch /pro und /profil nutzen.
export default async function ProSection({
  texts,
  locale,
}: {
  texts: HomeTexts;
  /** Für den Pro-Namespace und den Preis: beide bleiben bei next-intl bzw. Stripe. */
  locale: string;
}) {
  const tPro = await getTranslations({ locale, namespace: "Pro" });
  const price = formatProPrice(await getProPrice(), locale);

  return (
    <section className="px-4 py-16 md:py-24">
      <div className="mx-auto w-full max-w-[440px]">
        {/* EINE zusammenhängende Fläche: warmer Salzburg-Verlauf oben, fliessend nach unten
            zu Features und Kauf. Keine abgesetzten Einzel-Kacheln -> ruhig & Apple-artig.
            (Identisch zu ProLanding.tsx.) */}
        <div className="overflow-hidden rounded-[28px] bg-gradient-to-b from-accent/[0.12] via-white to-white shadow-[0_24px_60px_-28px_rgba(204,41,36,0.45)] ring-1 ring-black/[0.05]">
          <div className="px-7 pt-8 text-center">
            <ProWordmark name={tPro("title")} className="text-[15px]" />
            <h2 className="mt-5 text-[27px] font-bold leading-[1.15] tracking-tight text-ink">
              {texts.proTitle}
            </h2>
          </div>

          {/* Features als warme iOS-Zeilen mit Emoji-Chips (identisch zu ProLanding). */}
          <ul className="mt-7 space-y-1 px-5">
            {PRO_FEATURES.map((f) => (
              <li key={f.key} className="flex items-center gap-3.5 rounded-2xl px-2 py-2.5">
                <span
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-accent/10 text-[19px]"
                  aria-hidden
                >
                  {f.icon}
                </span>
                <span className="text-[15px] font-medium leading-snug text-ink">
                  {tPro(f.key)}
                </span>
              </li>
            ))}
          </ul>

          <div className="mt-6 px-7 pb-8">
            {/* Ohne konfiguriertes Stripe gibt es keinen Preis, dann auch keine Preis-Zeile
                und kein Kauf-Versprechen, statt einer erfundenen Zahl. */}
            {price && (
              <p className="flex items-baseline justify-center gap-2">
                <span className="text-[34px] font-bold tracking-tight text-ink">{price}</span>
                <span className="text-[14px] text-muted">{tPro("oneTime")}</span>
              </p>
            )}
            <Link
              href="/pro"
              className={`mt-4 block w-full text-center ${CTA_PRIMARY}`}
            >
              {texts.proCta}
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
