import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import Disclosure from "@/components/Disclosure";
import EmergencyNumbers from "@/components/EmergencyNumbers";
import JsonLd from "@/components/JsonLd";
import TravelInfoOutro from "@/components/TravelInfoOutro";
import { ChevronRight } from "@/components/icons";
import { faqLd } from "@/lib/jsonld";
import { alternatesFor, ogFor } from "@/lib/metadata";
import { GLANCE_ITEMS, TRAVEL_BLOCKS, getTravelInfo } from "@/lib/travel-info";

// „Gut zu wissen" — die Praxis-Seite für Salzburg. Alles, was ein Gast beim Ankommen in
// einem fremden Land wirklich braucht: Notruf, Währung, Öffis, Flughafen, Taxi, Packliste.
//
// SalzGuide beantwortet „wohin gehe ich" gut und beantwortete „wie funktioniert dieses
// Land" bisher gar nicht. Genau das sucht sich sonst jeder in dreissig Tabs zusammen.
//
// Bewusst NICHT prominent: Die Seite sitzt am PC im „Mehr"-Menü und am Handy im Burger
// (ein Eintrag in lib/nav.ts, beide Header lesen dieselbe Liste). Wer sie braucht, sucht
// sie; wer sie nicht braucht, stolpert nicht darüber.
//
// Aufbau: zwei immer sichtbare Blöcke (Notruf, Auf einen Blick), dann sieben Themen zum
// Aufklappen. Zugeklappt sind das neun Zeilen statt einer Textwüste.
//
// KEIN Supabase-Import: Die Seite bleibt dadurch statisch vorgerendert (● im Build), wie
// /ki und /rechtliches. Ihre Texte stehen in src/content/travel-info/ und nicht in
// messages/ — die Begründung steht bei lib/travel-info.ts.
//
// KEINE PREISE, nirgends (Entscheidung Anton, 08/2026): Erklärt wird die Mechanik („für
// die Autobahn brauchst du eine Vignette, digital, ans Kennzeichen"), nie der Betrag.
// Ein Betrag müsste jedes Jahr in dreizehn Dateien nachgezogen werden, und der einzige
// Zustand, in dem er sicher falsch ist, ist der, in dem ihn niemand nachzieht.

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Meta" });
  return {
    title: t("travelInfoTitle"),
    description: t("travelInfoDescription"),
    alternates: alternatesFor(locale, "/gut-zu-wissen"),
    ...ogFor({
      locale,
      path: "/gut-zu-wissen",
      title: t("travelInfoTitle"),
      description: t("travelInfoDescription"),
    }),
  };
}

export default async function TravelInfoPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const c = await getTravelInfo(locale);

  // Alle Fragen der Seite, flach, für die strukturierten Daten. Aus derselben Liste wie
  // die sichtbaren Blöcke: Eine zweite, handgepflegte Aufzählung wäre schon beim nächsten
  // neuen Thema veraltet, und schema.org verlangt ausdrücklich, dass beides übereinstimmt.
  const faq = TRAVEL_BLOCKS.flatMap((block) =>
    block.items.map((item) => {
      const entry = c.blocks[block.key].items[item.key];
      return { q: entry.q, a: entry.a };
    }),
  );

  return (
    // +40px: wie /ueber-uns beginnt die Seite mit einem Titelblock und trägt etwas mehr
    // Luft als die Listen-Seiten. Der Sockel kommt trotzdem aus --sg-page-top, damit der
    // Titel nicht hinter dem Header landet, wenn der Header wächst.
    // Kein eigenes pb: Den Platz über der Tab-Leiste bringt LegalFooter für alle Seiten mit.
    <div className="pt-[calc(var(--sg-page-top)+40px)] md:pt-10">
      <JsonLd data={faqLd(faq)} />

      <div className="mx-auto w-full max-w-[680px] px-5 md:px-8">
        <header className="text-center">
          <h1 className="text-balance text-[34px] font-bold leading-[1.05] tracking-tight text-ink md:text-[46px]">
            {c.title}
          </h1>
          <p className="mx-auto mt-4 max-w-[38ch] text-balance text-[16px] leading-relaxed text-muted md:text-[18px]">
            {c.intro}
          </p>
        </header>

        {/* ── NOTRUF ─── Ganz oben und immer offen. Siehe EmergencyNumbers.tsx. */}
        <div className="mt-10">
          <EmergencyNumbers
            title={c.emergency.title}
            note={c.emergency.note}
            labels={c.emergency.labels}
          />
        </div>

        {/* ── AUF EINEN BLICK ─── Sechs Kacheln, die man liest, ohne zu lesen. Auch das
            ist bewusst nicht aufklappbar: Wer „Euro" oder „Sonntag zu" erst suchen muss,
            hat es woanders schneller gefunden. */}
        <section className="mt-8">
          <h2 className="px-1 text-[15px] font-semibold text-ink">{c.glance.title}</h2>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {GLANCE_ITEMS.map((g) => {
              const item = c.glance.items[g.key];
              return (
                <div
                  key={g.key}
                  className="rounded-[16px] bg-white px-3.5 py-3 shadow-[0_1px_2px_rgba(0,0,0,0.04)]"
                >
                  <span className="text-[18px] leading-none" aria-hidden>
                    {g.emoji}
                  </span>
                  <p className="mt-1.5 text-[12px] leading-tight text-muted">{item.label}</p>
                  <p className="text-[15px] font-semibold leading-tight text-ink">
                    {item.value}
                  </p>
                </div>
              );
            })}
          </div>
        </section>

        {/* ── DIE SIEBEN THEMEN ─── Reihenfolge und Inhalt kommen aus TRAVEL_BLOCKS. */}
        <div className="mt-10 flex flex-col gap-2.5">
          {TRAVEL_BLOCKS.map((block) => {
            const b = c.blocks[block.key];
            return (
              <Disclosure key={block.key} id={block.key} emoji={block.emoji} title={b.title} hint={b.hint}>
                <div className="flex flex-col gap-5">
                  {block.items.map((item) => {
                    const entry = b.items[item.key];
                    return (
                      <div key={item.key}>
                        <h3 className="text-[15px] font-semibold leading-snug text-ink">
                          {entry.q}
                        </h3>
                        <p className="mt-1 text-[15px] leading-relaxed text-muted">{entry.a}</p>
                        {/* Weiterweg in die App. Die Adresse steht im Code (TRAVEL_BLOCKS),
                            nur die Beschriftung ist übersetzt. */}
                        {item.href && entry.link && (
                          <Link
                            href={item.href}
                            className="mt-2 inline-flex items-center gap-1 text-[14px] font-medium text-accent"
                          >
                            {entry.link}
                            <ChevronRight className="h-3.5 w-3.5" />
                          </Link>
                        )}
                      </div>
                    );
                  })}
                </div>
              </Disclosure>
            );
          })}
        </div>

        <TravelInfoOutro
          title={c.outro.title}
          body={c.outro.body}
          ai={c.outro.ai}
          cta={c.outro.cta}
        />
      </div>
    </div>
  );
}
