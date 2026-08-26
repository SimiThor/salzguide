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
//
// KEINE FARB-ÜBERBLENDUNG BEIM UMSCHALTEN, und das ist der Kern eines gemeldeten
// Fehlers: Mit einer Farb-Transition blendet die abgewählte Pille über 150ms von Dunkel
// nach Hell — die neu gewählte wird aber SOFORT dunkel (nachgemessen: die eine über 21
// Zwischenstufen, die andere in zwei). In der Überlappung sind BEIDE gleichzeitig
// dunkel, gemessen acht Frames am Stück, also rund eine Zehntelsekunde, in der zwei
// Kategorien ausgewählt aussehen. Genau das liest sich als Flackern.
//
// Die Auswahl springt deshalb hart: Sie ist ein Zustand, kein Verlauf, und es darf zu
// keinem Zeitpunkt zwei dunkle Pillen geben. iOS macht es genauso — bei einem Segmented
// Control wandert der Indikator, aber es blenden nie zwei Flächen ineinander. Das
// Press-Feedback (`active:`) bleibt, ein Druck darf sofort antworten.
//
// KEIN `sg-hit` HIER, und das ist eine Lehre, keine Nachlässigkeit: Die Klasse legt ein
// absolut positioniertes ::after von 44px über den Knopf. Die Pille ist 32px hoch, die
// Fläche ragt also 6px oben und unten heraus. Unten überschreitet sie das 4px-Polster des
// Scroll-Streifens, und weil ein Element mit `overflow-x: auto` zwangsläufig auch auf der
// anderen Achse zum Scroll-Container wird, war der Streifen dadurch 2px VERTIKAL
// scrollbar (nachgemessen: clientHeight 40, scrollHeight 42, `scrollTop = 50` landet
// auf 2). Am iPhone frisst genau das den Anfang jeder senkrechten Geste: Der Finger
// schiebt erst diese zwei Pixel, statt das Sheet zu greifen, und die Zeile zappelt.
// ScrollStrip klemmt die Achse jetzt zusätzlich ab, aber die Ursache gehört trotzdem
// nicht in eine waagrechte Leiste.
const PILL =
  "cursor-pointer sg-native-tap shrink-0 whitespace-nowrap rounded-full px-4 py-1.5 text-[13px] font-semibold";
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
    let ziel = box.scrollLeft;
    if (p.right > b.right) ziel += p.right - b.right + air;
    else if (p.left < b.left) ziel -= b.left - p.left + air;
    if (ziel === box.scrollLeft) return;

    // WEICH HINFAHREN, NICHT SPRINGEN. Tippt man eine Pille an, die am Rand halb
    // abgeschnitten ist, muss der Streifen sie hereinholen — nachgemessen waren das
    // 92px in EINEM Frame. Zusammen mit den beiden Pillen, die im selben Moment ihre
    // Farbe tauschen, und dem Verlauf, der am Rand ein- oder aussetzt, liest sich das
    // als Zucken statt als Bewegung.
    //
    // `scrollTo` mit `behavior` und NICHT die CSS-Eigenschaft `scroll-behavior`: Die
    // gälte auch fürs Ziehen mit der Maus, und dann liefe die Leiste dem Finger
    // hinterher statt mit ihm (siehe ScrollStrip.tsx, „kein scroll-smooth").
    //
    // Wer Bewegung reduziert haben will, bekommt sie nicht: Für den ist ein Sprung
    // richtig, nicht eine langsamere Fahrt.
    const ruhig = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    box.scrollTo({ left: ziel, behavior: ruhig ? "auto" : "smooth" });
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
    // DAS px-4 GEHÖRT HIERHER UND IST NICHT KOSMETIK. ScrollStrip zieht sich mit `-mx-4`
    // bewusst über den Rand seines Rahmens, damit die Pillen bis an den Bildschirmrand
    // laufen statt vorher abzureissen — es SETZT also einen Rahmen mit px-4 voraus (so ist
    // es auf der Events-Seite und im Admin). Weder das Explore-Panel noch die Kopfzeile des
    // Sheets haben einen: dort bringt jedes Kind sein eigenes px-4 mit. Ohne diesen Rahmen
    // ragte der Streifen 16px über beide Kanten hinaus.
    //
    // KEIN `sticky` UND KEIN EIGENER HINTERGRUND MEHR. Beides stand hier, solange die
    // Leiste im scrollenden Inhalt lag, und beides war ein Behelf: Ein aufgesetzter
    // Hintergrund trifft nie exakt die Farbe des Sheets (volldeckendes Creme gegen
    // bg-cream/95 mit Blur), und nachgemessen blieb genau dort ein hellerer Streifen
    // zwischen Griff und Pillen stehen. Jetzt sitzt die Leiste in der FESTEN Kopfzeile
    // des Sheets (MobileSheet `header`) beziehungsweise über dem Scroller der
    // Desktop-Spalte. Damit kann nichts mehr darunter durchlaufen, es braucht keine
    // Abdeckung, und der Hintergrund ist einfach der des Sheets.
    //
    // `data-sg="filter-strip"` bleibt: MobileSheet misst hier die Ruheposition.
    <div data-sg="filter-strip" className="px-4">
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
