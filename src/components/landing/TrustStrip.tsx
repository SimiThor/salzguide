import type { SpotCount } from "@/lib/spots";
import type { HomeTexts } from "@/lib/home-fields";
import { fill } from "@/lib/home-content";
import { LANDING_CONTAINER } from "./layout";

// Vertrauen direkt unter dem Hero, bevor irgendetwas erklärt oder verkauft wird.
// Jede Aussage hier ist belegbar — siehe die Kommentare an den einzelnen Kacheln.
// Nichts hinzufügen, wofür es keine Abfrage gibt: die Zielgruppe (18–45, laut BRAND_VOICE
// „allergisch auf Tourismus-Marketing") riecht eine aufgeblasene Zahl zuerst, und dann ist
// der ganze „zwei ehrliche Locals"-Aufbau tot.
export default function TrustStrip({
  texts,
  spotCount,
}: {
  texts: HomeTexts;
  /** Live aus der DB (siehe getSpotCount). null = keine Spots -> Aussage weglassen. */
  spotCount: SpotCount | null;
}) {
  const items = [
    // Belegt: Anton und Simon gibt es, sie sind in Salzburg aufgewachsen.
    { icon: "👋", title: texts.trustLocalsTitle, body: texts.trustLocalsBody },
    // Belegt: Live-Count aus Supabase (getSpotCount). Zwei Texte, weil „60+ Spots" bei
    // 8 Spots „0+" ergäbe — dann zeigen wir die exakte Zahl statt einer kaputten Null.
    spotCount
      ? {
          icon: "🗺️",
          title: fill(
            spotCount.rounded ? texts.trustSpotsTitle : texts.trustSpotsTitleExact,
            { count: spotCount.value },
          ),
          body: texts.trustSpotsBody,
        }
      : null,
    // HERKUNFT DER ZAHL, bitte lesen, bevor jemand sie weiterverwendet:
    // Gemessen sind 25.000 einzelne BESUCHER der alten Seite (Antons Analytics, gesamt,
    // Stand 07/2026). Die 10.000 sind daraus KEINE Messung, sondern Antons bewusste,
    // konservative Schätzung, wie viele davon die Seite wirklich zum Planen genutzt haben
    // (Entscheidung Anton, 2026-07-16, nach dreimaligem Einwand meinerseits).
    //
    // Das heisst: Diese Zahl ist NICHT abgeleitet, nicht nachgerechnet und steht in keiner
    // Auswertung. Sie darf nirgends als Beleg zitiert werden, und sie darf nicht wachsen,
    // ohne dass jemand sie misst. (Genau so ist „60+ Spots" entstanden: einmal auf einem
    // Screenshot, dann in docs/32 als Produktfakt zitiert, und am Ende passte sie zu keiner
    // echten Zahl.)
    //
    // ERSETZEN, sobald es geht: /api/track + Migrationen 0019-0022 zählen echte Handlungen
    // (Spot gespeichert, Toni gefragt). Dann steht hier eine Zahl, die uns wirklich gehört,
    // und dieser Kommentar kann weg. Bis dahin ist „Trips geplant" neben dem Pro-Verkauf
    // eine Aussage über Nutzung, für die kein Messwert existiert (UWG § 2, AT).
    //
    // Format und zweite Zeile sind wörtlich von der alten SalzGuide-Seite (Antons Wunsch).
    { icon: "❤️", title: texts.trustVisitorsTitle, body: texts.trustVisitorsBody },
  ].filter((i) => i !== null);

  return (
    <section className={`${LANDING_CONTAINER} py-14 md:py-20`}>
      <ul className="grid gap-3 md:grid-cols-3 md:gap-4">
        {items.map((item) => (
          <li
            key={item.title}
            className="flex items-center gap-4 rounded-[22px] bg-white p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_32px_-20px_rgba(0,0,0,0.28)] ring-1 ring-black/[0.04] md:flex-col md:items-start md:gap-3 md:p-6"
          >
            <span
              className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-accent/10 text-[20px]"
              aria-hidden
            >
              {item.icon}
            </span>
            <div>
              <p className="text-[16px] font-semibold leading-snug text-ink">{item.title}</p>
              <p className="mt-0.5 text-[14px] leading-relaxed text-muted">{item.body}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
