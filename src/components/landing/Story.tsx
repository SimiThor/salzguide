import type { HomeTexts } from "@/lib/home-fields";
import { LANDING_CONTAINER, LANDING_SECTION_Y } from "./layout";

// Warum es SalzGuide gibt, plus was drin ist.
//
// Diese Section hat zwei Vorgänger, beide raus:
//   1. Eine eigene PROBLEM-Sektion („Freitagabend, 23 Uhr. 30 Tabs …"). Sie hat dem Leser
//      sein eigenes Elend erklärt; eine Belehrung, und niemand kommt auf eine Website, um
//      über seinen letzten Freitagabend belehrt zu werden.
//   2. „ChatGPT war noch nie am Fuschlsee." nach dem Muster von hikebeast.com. Klang
//      clever, aber der Absatz danach musste erst einen Badesee erklären, statt unser
//      Produkt zu zeigen. Zu generisch, zu weit weg vom Angebot (Antons Urteil, 07/2026).
//
// Seitdem spricht die Section dieselbe Sprache wie die SEO-Texte in Meta (Geheimtipps,
// Hidden Gems): EIN kurzer Claim, EIN Absatz, der sagt, was der Leser bekommt, nämlich
// Insider-Tipps von Leuten, die selbst dort waren. Behauptung nackt, Beleg (wer „wir"
// sind) kommt zwei Sections später bei den Gründern.
//
// Die Kacheln danach folgen hikebeasts Kachel-Muster: schlichter Titel, EINE Zeile Nutzen.
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

export default function Story({ texts }: { texts: HomeTexts }) {
  return (
    <section id="how" className={`scroll-mt-24 bg-white/60 ${LANDING_SECTION_Y}`}>
      <div className={LANDING_CONTAINER}>
        <div className="mx-auto max-w-[820px] text-center">
          <p className="text-[13px] font-semibold uppercase tracking-wider text-accent">
            {texts.pitchEyebrow}
          </p>
          {/* ACHTUNG bei `ch`: die Einheit rechnet gegen die Schriftgrösse des Elements, an
              dem sie steht. Ein max-w-[38ch] am Wrapper (16px) ergibt 384px und presst die
              42px-Überschrift darin auf vier Zeilen. Zeilenlängen also IMMER am Text-Element
              selbst begrenzen, nie am Container. So macht es auch der Hero. */}
          <h2 className="mx-auto mt-3 max-w-[27ch] text-balance text-[30px] font-bold leading-[1.15] tracking-tight text-ink md:text-[42px]">
            {texts.pitchTitle}
          </h2>
          <p className="mx-auto mt-4 max-w-[52ch] text-balance text-[16px] leading-relaxed text-muted md:text-[18px]">
            {texts.pitchBody}
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
                {texts[`${f.key}Title`]}
              </p>
              <p className="mt-2 text-[15px] leading-relaxed text-muted">{texts[`${f.key}Body`]}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
