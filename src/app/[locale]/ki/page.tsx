import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { alternatesFor, ogFor } from "@/lib/metadata";

// KI-Transparenz („Mit Liebe und KI gemacht"). Erfüllt zusammen mit dem Hinweis im
// Toni-Chat die Transparenzpflichten aus Art. 50 KI-VO (Verordnung (EU) 2024/1689) und
// ist bewusst eine warme Marken-Seite, kein Rechtstext. Verlinkt aus der Fußzeile
// (Legal.aiMotto) und aus dem Chat-Disclaimer. Die rechtliche Einstufung aller
// KI-Funktionen steht in docs/39_RECHT_KI-Transparenz.md.
// BEWUSST ohne Supabase-Import: die Seite bleibt statisch (● im Build).

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Meta" });
  return {
    title: t("aiTransparencyTitle"),
    description: t("aiTransparencyDescription"),
    alternates: alternatesFor(locale, "/ki"),
    ...ogFor({
      locale,
      path: "/ki",
      title: t("aiTransparencyTitle"),
      description: t("aiTransparencyDescription"),
    }),
  };
}

// Reihenfolge = Leselogik: erst Toni (die sichtbarste KI), dann Texte, dann Stimme,
// dann die Grenze (was ohne KI läuft), zuletzt das Rechtliche mit dem Datenschutz-Link.
const SECTIONS = ["toni", "texts", "voice", "human", "law"] as const;

export default async function AiTransparencyPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "AiTransparency" });
  const tLegal = await getTranslations({ locale, namespace: "Legal" });

  return (
    // Kein eigenes pb: Den Platz über der Tab-Leiste bringt die Rechts-Fusszeile für ALLE
    // Seiten mit (LegalFooter, pb aus --sg-nav-h) — das env()-Polster hier war ein zweiter,
    // handgerechneter Nav-Ausgleich und stapelte sich mit dem Footer-Abstand.
    <main className="mx-auto w-full max-w-[640px] px-4 pt-[var(--sg-page-top)] md:pt-8">
      <h1 className="text-[28px] font-bold leading-tight text-ink">{t("title")}</h1>
      <p className="mt-2 text-[15px] leading-relaxed text-muted">{t("intro")}</p>

      {SECTIONS.map((s) => (
        <section key={s} className="mt-8">
          <h2 className="text-[19px] font-semibold text-ink">{t(`${s}Title`)}</h2>
          <p className="mt-1.5 text-[15px] leading-relaxed text-muted">{t(`${s}Body`)}</p>
          {s === "law" && (
            <p className="mt-2 text-[15px]">
              <Link
                href="/rechtliches/datenschutz"
                className="font-medium text-accent underline decoration-accent/40 underline-offset-2"
              >
                {tLegal("privacy")}
              </Link>
            </p>
          )}
        </section>
      ))}
    </main>
  );
}
