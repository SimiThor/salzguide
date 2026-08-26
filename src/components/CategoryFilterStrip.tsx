"use client";

import { useEffect, useRef } from "react";
import ScrollStrip from "./ScrollStrip";
import type { Season } from "@/lib/season";
import type { ExploreCategory } from "@/lib/spots";

// ═══════════════════════════════════════════════════════════════════════════════════════
//  Die Filter-Pillen über der Explore-Karte.
// ═══════════════════════════════════════════════════════════════════════════════════════
//
// WAS SIE LÖST: Auf der Karte lagen alle Spots gleichzeitig, und wer wissen wollte, wo
// man essen geht, musste sich durch neun Karussell-Regale scrollen. Genau dafür führen
// Airbnb, Google Maps und Apple Maps eine waagrechte Kategorie-Leiste über der Karte.
// Gemeinsamer Nenner dieser drei, und deshalb auch hier: EINE Auswahl, sofortige
// Wirkung, kein Bestätigen.
//
// DIE FREMDE SAISON STEHT MIT DRIN, und das ist der eigentliche Kniff. Für Nutzer ist
// die Saison keine Ebene über allem, sondern eine Eigenschaft der Kategorie: bergfex und
// Outdooractive führen Schneeschuh und Skitour einfach neben den Sommer-Kategorien.
// Deshalb hängen hinter einer Trennlinie die Kategorien der anderen Saison. Ein Tipp
// darauf schaltet die Saison mit um (die Entscheidung trifft Explore.tsx, nicht diese
// Datei), statt einen zweiten Filter aufzumachen, der dem ersten widerspricht.
//
// WARUM ES DIE „Alle"-PILLE GIBT, obwohl Airbnb keine hat: Sie ist der sichtbare Ausgang.
// Ohne sie kommt man nur über die versteckte Geste „aktive Pille nochmal antippen"
// zurück, und wer bei Pille neun steht, müsste dafür erst zurückscrollen. Die Geste gibt
// es trotzdem, sie kostet nichts. Ausserdem hat die Events-Seite dieselbe Pille — ein
// Muster für die ganze App (EventsWeek.tsx).

/** Was gerade gefiltert ist. Die Saison gehört dazu, weil `key` nur JE SAISON eindeutig
 *  ist: 'food' gibt es im Sommer („Food Spots") und im Winter („Skihütten & Cafés"). */
export type CategoryFilter = { key: string; season: Season };

export const isSameFilter = (a: CategoryFilter | null, b: CategoryFilter | null): boolean =>
  a?.key === b?.key && a?.season === b?.season;

const SEASON_ICON: Record<Season, string> = { summer: "☀️", winter: "❄️" };

// Pillen-Optik des Hauses, wortgleich mit dem Event-Filter (EventsWeek.tsx). Sie steht
// hier als Konstante und nicht dreimal im JSX, weil sonst genau die Drift entsteht, die
// ScrollStrip schon einmal eingesammelt hat: vier fast gleiche Fassungen derselben Leiste.
//
// shrink-0 + whitespace-nowrap: Eine Pille bleibt eine Pille. Ohne das rechnet Flex sie
// schmal und „Klammen & Wasserfälle" bricht zweizeilig um, statt zu scrollen.
// sg-hit: 44pt Trefferfläche am Finger. Wächst nur nach oben und unten, weil jede Pille
// breiter als 44px ist — sie nimmt also keinem Nachbarn den Tipp weg.
const PILL =
  "cursor-pointer sg-hit sg-native-tap shrink-0 whitespace-nowrap rounded-full px-4 py-1.5 text-[13px] font-semibold transition-colors";
const PILL_ON = "bg-ink text-white";
const PILL_OFF = "bg-black/[0.06] text-ink/70 active:bg-black/[0.1]";

export default function CategoryFilterStrip({
  categories,
  season,
  value,
  onSelect,
  labels,
}: {
  /** Kategorien BEIDER Saisonen, vom Aufrufer schon auf „hat Spots" gefiltert. */
  categories: ExploreCategory[];
  season: Season;
  value: CategoryFilter | null;
  /** `null` = „Alle". Was ein Tipp bedeutet (filtern, abwählen, Saison wechseln),
   *  entscheidet Explore.tsx an einer Stelle. */
  onSelect: (next: CategoryFilter | null) => void;
  labels: { all: string; summer: string; winter: string };
}) {
  const strip = useRef<HTMLDivElement>(null);
  const activePill = useRef<HTMLButtonElement>(null);

  const own = categories.filter((c) => c.season === season);
  const otherSeason: Season = season === "summer" ? "winter" : "summer";
  const other = categories.filter((c) => c.season === otherSeason);

  // Die aktive Pille kann ausserhalb des sichtbaren Streifens liegen — nach einem Tipp
  // auf eine Fremd-Saison-Pille sogar zwangsläufig, weil die Leiste sich dabei komplett
  // umbaut und die eben gewählte Kategorie nach vorne rutscht. Dieselbe Rechnung wie in
  // AdminNav.tsx: NICHT scrollIntoView, das scrollt auch die Seite und jeden Vorfahren
  // mit Overflow, hier also das Sheet.
  const prevSeason = useRef(season);
  useEffect(() => {
    const box = strip.current;
    if (!box) return;

    // BEIM SAISON-WECHSEL ERST GANZ NACH LINKS, und das ist kein Schönheitsputz:
    // Um eine Winter-Pille im Sommer zu erreichen, scrollt man weit nach rechts. Danach
    // baut sich die Leiste um, die Winter-Kategorien stehen jetzt vorne — der alte
    // Scrollstand bleibt aber stehen. Die eben gewählte Pille ist dann zwar sichtbar
    // (die Korrektur unten greift also nicht), aber „Alle" davor ist links aus dem Bild
    // gerutscht. Nachgemessen: die aktive Pille klebte bei x=33 am linken Rand, der
    // Ausgang war weg. Wer nicht weiss, dass man die aktive Pille nochmal antippen kann,
    // sitzt fest.
    if (prevSeason.current !== season) {
      prevSeason.current = season;
      box.scrollLeft = 0;
    }

    const pill = activePill.current;
    if (!pill) return;
    const b = box.getBoundingClientRect();
    const p = pill.getBoundingClientRect();
    const air = 16; // damit die Pille nicht am Rand klebt
    if (p.right > b.right) box.scrollLeft += p.right - b.right + air;
    else if (p.left < b.left) box.scrollLeft -= b.left - p.left + air;
  }, [value?.key, value?.season, season]);

  const pill = (cat: ExploreCategory) => {
    const active = isSameFilter(value, { key: cat.key, season: cat.season as Season });
    const foreign = cat.season !== season;
    return (
      <button
        key={`${cat.season}:${cat.key}`}
        ref={active ? activePill : undefined}
        type="button"
        onClick={() => onSelect({ key: cat.key, season: cat.season as Season })}
        aria-pressed={active}
        // Die Saison steht für Screenreader IM Namen der Pille, nicht nur in der
        // Trennlinie daneben. Ein role="group" um die fremden Pillen wäre die
        // schönere Auszeichnung und hinge an display:contents, das manche Browser
        // samt Rolle aus dem Baum werfen. Ein Wort im Namen tut es zuverlässig.
        aria-label={foreign ? `${cat.title} (${labels[otherSeason]})` : undefined}
        className={`${PILL} ${active ? PILL_ON : PILL_OFF}`}
      >
        {cat.emoji ? `${cat.emoji} ` : ""}
        {cat.title}
      </button>
    );
  };

  return (
    // DAS px-4 GEHÖRT HIERHER UND IST NICHT KOSMETIK. ScrollStrip zieht sich mit
    // `-mx-4` bewusst über den Rand seines Rahmens, damit die Pillen bis an den
    // Bildschirmrand laufen statt vorher abzureissen — es SETZT also einen Rahmen mit
    // px-4 voraus (so ist es auf der Events-Seite und im Admin). Das Explore-Panel hat
    // keinen: dort bringt jedes Kind sein eigenes px-4 mit. Ohne diesen Rahmen ragte
    // der Streifen 16px über beide Panelkanten hinaus, und weil `overflow-y: auto` die
    // andere Achse zwangsweise auf `auto` mitzieht, liesse sich das ganze Panel
    // seitlich wegschieben — genau der Fehler, für den es ScrollStrip überhaupt gibt.
    //
    // Der Anker für die Ruheposition des Bottom-Sheets sitzt AUSSEN, um den Streifen
    // herum: MobileSheet misst die Unterkante dieses Elements, und die Luft, die
    // ScrollStrip für Schatten und Ring mitbringt, gehört dazu (siehe ScrollStrip.tsx,
    // „py-1 gegen das Anschneiden oben").
    // KLEBT OBEN. Eine Kategorie kann 24 Spots haben; wer unten in der Liste steht und
    // umschalten will, müsste sonst erst wieder ganz hochscrollen. Airbnb und Apple
    // Karten heften ihre Filterzeile aus demselben Grund an den oberen Rand.
    //
    // Volldeckendes bg-cream statt eines zweiten backdrop-filter: Das Sheet trägt schon
    // einen (bg-cream/95 backdrop-blur-xl), und ein Blur IM Blur ist genau die
    // Konstellation, in der Safari nicht mehr neu zeichnet (siehe .sg-own-layer in
    // globals.css). Deckend ist hier ohnehin richtig, sonst schimmern die Karten durch,
    // die darunter durchlaufen.
    //
    // ── DAS `before:` IST DER SCHLITZ-VERSCHLUSS, und ohne ihn ist die Leiste kaputt ──
    //
    // `sticky top-0` heftet an den SCROLLPORT, und der beginnt hinter dem Innenabstand
    // des Scrollers. Der Sheet-Körper hat pt-1, die Desktop-Spalte pt-5. Genau dieses
    // Band bleibt also unbedeckt, und beim Scrollen laufen die Fotos sichtbar
    // hindurch: nachgemessen 4px am iPhone (Griff endet bei 110.4, Leiste beginnt bei
    // 114.4), 20px am PC. Ein 4px-Flimmern unter dem Griff sieht nicht nach 4px aus,
    // es sieht nach kaputt aus.
    //
    // Die Fläche hängt sich nach OBEN aus der Leiste heraus und füllt das Band. Sie ist
    // absichtlich viel höher als jeder denkbare Innenabstand, und das kostet nichts: Der
    // Scroller schneidet an seinem Padding-Kasten ab, sichtbar wird also immer genau so
    // viel, wie zu decken ist — nie mehr. Damit steht hier KEINE Zahl, die zur pt-Klasse
    // des Aufrufers passen muss und beim nächsten Umbau still danebenliegt.
    //
    // Bedingung, die dafür gelten muss: Dieser Streifen ist das ERSTE Kind seines
    // Scrollers. Stünde etwas über ihm, deckte die Fläche es im geklebten Zustand zu.
    <div
      data-sg="filter-strip"
      className="sticky top-0 z-10 bg-cream px-4 before:absolute before:inset-x-0 before:bottom-full before:h-24 before:bg-cream before:content-['']"
    >
      <ScrollStrip scrollRef={strip}>
        <div className="flex w-max items-center gap-2">
          <button
            type="button"
            onClick={() => onSelect(null)}
            aria-pressed={value == null}
            className={`${PILL} ${value == null ? PILL_ON : PILL_OFF}`}
          >
            {labels.all}
          </button>
          {own.map(pill)}
          {other.length > 0 && (
            // Haarlinie plus stille Beschriftung, kein Knopf: Sie sagt, wo die andere
            // Saison anfängt. Als Pille getarnt würde sie angetippt werden und nichts
            // tun. aria-hidden, weil dieselbe Auskunft schon im Namen jeder Pille
            // dahinter steckt — sonst hört ein Screenreader „Winter" doppelt.
            <span
              aria-hidden
              className="ml-1 flex shrink-0 items-center gap-2 pr-1 text-[12px] font-semibold text-muted"
            >
              <span className="h-5 w-px bg-black/10" />
              {SEASON_ICON[otherSeason]} {labels[otherSeason]}
            </span>
          )}
          {other.map(pill)}
        </div>
      </ScrollStrip>
    </div>
  );
}
