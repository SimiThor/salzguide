import { getTranslations } from "next-intl/server";
import { LANDING_CONTAINER } from "./layout";

// Warum es SalzGuide gibt, plus was drin ist.
//
// Hier stand mal eine eigene PROBLEM-Sektion („Freitagabend, 23 Uhr. 30 Tabs. Drei Blogs,
// zwei Listen …"). Die ist raus, und zwar nicht wegen der Formulierung: Sie hat dem Leser
// sein eigenes Elend erklärt. Das ist eine Belehrung, und niemand kommt auf eine Website,
// um über seinen letzten Freitagabend belehrt zu werden.
//
// Stattdessen das Muster von hikebeast.com, dessen bester Satz lautet: „Die schönsten Orte
// der Schweiz findest du nicht mit ChatGPT. Sie sind in Whatsapp Gruppen von Schweizern."
// EIN Absatz, der das Problem andeutet, WÄHREND er die Lösung nennt. Er hat gar keine
// Problem-Sektion.
//
// Die Kacheln danach folgen seinem Kachel-Muster: schlichter Titel, EINE Zeile Nutzen.
// Test: nur die Titel lesen. Wer scannt, muss damit das Produkt haben.
//
// Drei Kacheln, und jede ist bei 7 von 7 freien Spots gedeckt. Hier standen mal vier:
// „Öffnungszeiten stehen beim Platz" (google_place_id: 1 von 7) und „Auto oder Öffis"
// (Öffi-Koordinate: 1 von 7) hingen an je EINEM Spot. Ein Feature, das es bei einem
// Siebtel gibt, ist kein Feature, sondern eine Behauptung, die beim zweiten Klick
// auffliegt. Beide kommen zurück, sobald die Daten gepflegt sind.
// feat2 (Insider-Tipp) ist der Grund, warum es die Seite gibt: 7 von 7 gepflegt, und das
// Einzige, was weder Google Maps noch ChatGPT hat.
// feat3 ist Events. Belegt: 25 kommende Events in der DB, Import jeden Montag 05:00
// (vercel.json cron "0 5 * * 1"), redaktionell freigegeben.
// Die vier Beispiele im Text sind die vier ECHTEN Kategorien der events-Tabelle
// (kultur, party, tradition, sport) und decken damit den ganzen Feed ab.
// NICHT „die coolsten Events für junge Leute" schreiben, solange die Daten das nicht
// hergeben: Von den 25 kommenden sind 13 kultur und 5 tradition (Festspiele, Jedermann,
// Carmen, Volkskultur-Tag), nur 4 party. Wer auf so eine Zeile klickt, liest als Erstes
// „Jedermann", und der Satz ist beim ersten Klick tot. Sobald im Admin konsequenter
// kuratiert wird (draft -> published), darf die Zeile mitwachsen.
// (Hier stand davor Wetter, davor Sommer/Winter. Beides gestrichen: das eine kein
// Hauptfeature, das andere beschrieb nur eine Funktion.)
const FEATURES = [
  { key: "feat1", icon: "🗺️" },
  { key: "feat2", icon: "💬" },
  { key: "feat3", icon: "🔥" },
] as const;

export default async function Story({ locale }: { locale: string }) {
  const t = await getTranslations({ locale, namespace: "Home" });

  return (
    <section id="how" className="scroll-mt-24 bg-white/60 py-16 md:py-24">
      <div className={LANDING_CONTAINER}>
        <div className="mx-auto max-w-[820px] text-center">
          <p className="text-[13px] font-semibold uppercase tracking-wider text-accent">
            {t("pitchEyebrow")}
          </p>
          {/* ACHTUNG bei `ch`: die Einheit rechnet gegen die Schriftgrösse des Elements, an
              dem sie steht. Ein max-w-[38ch] am Wrapper (16px) ergibt 384px und presst die
              42px-Überschrift darin auf vier Zeilen. Zeilenlängen also IMMER am Text-Element
              selbst begrenzen, nie am Container. So macht es auch der Hero. */}
          <h2 className="mx-auto mt-3 max-w-[27ch] text-balance text-[30px] font-bold leading-[1.15] tracking-tight text-ink md:text-[42px]">
            {t("pitchTitle")}
          </h2>
          <p className="mx-auto mt-4 max-w-[52ch] text-balance text-[16px] leading-relaxed text-muted md:text-[18px]">
            {t("pitchBody")}
          </p>
        </div>

        <ul className="mx-auto mt-12 grid max-w-[900px] gap-4 md:mt-16 md:grid-cols-3">
          {FEATURES.map((f) => (
            <li key={f.key} className="rounded-[22px] bg-cream p-6 ring-1 ring-black/[0.04] md:p-7">
              <span
                className="grid h-12 w-12 place-items-center rounded-full bg-accent/10 text-[22px]"
                aria-hidden
              >
                {f.icon}
              </span>
              <p className="mt-4 text-[19px] font-bold leading-snug tracking-tight text-ink">
                {t(`${f.key}Title`)}
              </p>
              <p className="mt-2 text-[15px] leading-relaxed text-muted">{t(`${f.key}Body`)}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
