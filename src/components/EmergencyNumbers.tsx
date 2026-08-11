import { EMERGENCY_MORE, EMERGENCY_PRIMARY } from "@/lib/travel-info";

// Die Notruf-Karte auf „Gut zu wissen". Steht ganz oben und ist als EINZIGER Block der
// Seite nicht aufklappbar: Eine Nummer, die man erst aufklappen muss, ist im Ernstfall
// keine.
//
// Die Nummern sind echte tel:-Links, kein Text zum Abtippen. Wer sie braucht, hat selten
// eine ruhige Hand.
//
// Rot ist in dieser App sonst „aktive Seite" und wird deshalb sparsam eingesetzt. Hier ist
// es die richtige Farbe, aber nur als Tönung: heller Grund, rote Ziffern, dünner Ring. Eine
// vollrote Fläche wäre auf einer Seite, die man aus Neugier liest, ein Daueralarm.
export default function EmergencyNumbers({
  title,
  note,
  labels,
}: {
  title: string;
  note: string;
  /** Beschriftung je Nummern-Schlüssel, aus src/content/travel-info/<locale>.json. */
  labels: Record<string, string>;
}) {
  return (
    <section className="rounded-[22px] bg-accent/[0.05] p-4 ring-1 ring-accent/[0.12]">
      <h2 className="flex items-center gap-2 px-1 text-[15px] font-semibold text-ink">
        <span className="text-[18px] leading-none" aria-hidden>
          ⚡
        </span>
        {title}
      </h2>

      {/* Die drei grossen: der Euro-Notruf, der auch dann funktioniert, wenn jemand sonst
          gar nichts über dieses Land weiss, plus Rettung und Bergrettung. Letztere ist in
          einem Land aus Bergen keine Fussnote: 144 schickt einen Wagen auf eine Strasse,
          140 schickt Leute an einen Hang. */}
      <div className="mt-3 grid grid-cols-3 gap-2">
        {EMERGENCY_PRIMARY.map((n) => (
          <a
            key={n.number}
            href={`tel:${n.number}`}
            className="flex flex-col items-center justify-center gap-0.5 rounded-[16px] bg-white px-2 py-3 text-center shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition active:scale-[0.98]"
          >
            <span className="text-[26px] font-bold leading-none tracking-tight text-accent">
              {n.number}
            </span>
            <span className="text-[12px] font-medium leading-tight text-muted">
              {labels[n.key]}
            </span>
          </a>
        ))}
      </div>

      {/* Der Rest als fliessende Zeile mit Trennpunkten, nicht als weitere Kacheln.
          Genau dieses Muster tragen die Rechtslinks in Fusszeile, Burger und PC-Menü, und
          zwar aus demselben Grund: Es sind Nebenpunkte, und sie sollen leiser sein als das,
          was darüber steht.
          Zwei Zwischenstände lagen daneben und stehen hier, damit niemand sie erneut
          probiert. Als Pillen mit flex-wrap brachen die vier unterschiedlich langen Namen
          als 2-1-1 über drei krumme Zeilen um. In einem festen Zweispalter blieben auf
          390px rund 90px für den Namen, und „Gesundheitsberatung" wurde zu
          „Gesundheits…" (in dreizehn Sprachen ist so eine Breite nicht zu halten). Als
          volle Zeilen untereinander war die Karte dreimal so hoch wie der Rest der Seite
          und damit das lauteste Ding auf einer Seite, die aufgeräumt sein soll.
          KEIN sg-hit: Dessen unsichtbare 44px-Fläche überdeckt in einer eng umbrechenden
          Zeile die Nachbarn und nimmt ihnen Tipps weg (die Warnung steht an .sg-hit selbst
          in globals.css). Stattdessen py-1.5 als echtes Polster, wie im Burger-Menü. */}
      {/* OHNE Trennpunkte, anders als bei den Rechtslinks: Wo die Zeile umbricht, hängt
          sonst ein Punkt am Zeilenende in der Luft (in dreizehn Sprachen bricht sie an
          dreizehn verschiedenen Stellen um). Hier braucht es ihn auch nicht — jeder
          Eintrag beginnt mit einer fetten roten Zahl, das trennt deutlicher als ein Punkt.
          Der breitere gap-x macht den Rest. */}
      <div className="mt-2.5 flex flex-wrap gap-x-4 px-1 text-[13px]">
        {EMERGENCY_MORE.map((n) => (
          <a key={n.number} href={`tel:${n.number}`} className="flex items-baseline gap-1.5 py-1.5">
            <span className="font-semibold text-accent">{n.number}</span>
            <span className="text-muted">{labels[n.key]}</span>
          </a>
        ))}
      </div>

      <p className="mt-3 px-1 text-[12px] leading-snug text-muted">{note}</p>
    </section>
  );
}
