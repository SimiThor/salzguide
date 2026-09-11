"use client";

import { useTranslations } from "next-intl";
import LockedMedia from "@/components/LockedMedia";
import ScrollStrip from "@/components/ScrollStrip";

// „Was drin ist" auf der Pro-Seite: echte Pro-Motive (verschwommen) und echte Zahlen.
//
// WARUM ES DAS GIBT: Bis 09/2026 standen auf /pro eine Überschrift, drei allgemeine Zeilen
// und der Preis. Man erfuhr weder, WIE VIEL hinter Pro steckt, noch WAS. Die Recherche zum
// Pro-Schnitt (Studie über 21 Nachrichtenseiten aus DE/AT) sagt dazu zweierlei: konkret
// zeigen, was man bekommt, und dabei Bilder zeigen, aber keinen beschreibenden Text. Der
// senkte die Chance auf einen Abschluss um 72 bis 86 %, verschwommene Bilder nicht messbar.
//
// Deshalb steht unter jedem Motiv nur die ART (Klamm, Café), nie der Ort: Das Ortsfeld eines
// Spots ist die Gemeinde, und Art plus Gemeinde wäre in einer Minute ergoogelt.
//
// Alle Zahlen kommen live aus der Datenbank (lib/pro-showcase.ts), nichts ist eingetippt.
// Wächst der Katalog oder werden Spots umgestellt, stimmt die Seite von selbst.

/**
 * Die Daten für diesen Block. Der Typ steht HIER und nicht in lib/pro-showcase.ts: Diese
 * Datei läuft im Browser, jene auf dem Server. Was beide brauchen, gehört auf die
 * Browser-Seite, der Server importiert von hier. Umgekehrt reisst ein Import aus einer
 * Server-Datei das Browser-Bündel mit, und tsc merkt davon nichts.
 */
export type ProShowcaseData = {
  /** Alle veröffentlichten Spots, frei und Pro: Wer kauft, bekommt den ganzen Katalog. */
  total: number;
  /** Davon nur mit Pro. */
  pro: number;
  /** Pro-Spots je Sommer-Regal, schon übersetzt, die grössten zuerst. */
  shelves: { key: string; label: string; count: number }[];
  /** Pro-Spots mit Winter-Saison. */
  winter: number;
  /** Veröffentlichte Pro-Audio-Touren. */
  tours: number;
  /** Verschwommene Motive, je eines aus einem anderen Regal. */
  tiles: { key: string; previewUrl: string | null; label: string | null }[];
};

/**
 * Oben auf /pro, ÜBER dem Kaufblock: die Motive und die zwei Zahlen, um die es geht. Die
 * Aufschlüsselung je Regal steht bewusst nicht hier, sondern darunter (ProShowcaseCounts),
 * damit der Kauf-Knopf nicht tiefer rutscht als vor diesem Block (siehe ProLanding).
 */
export default function ProShowcase({ data }: { data: ProShowcaseData }) {
  const t = useTranslations("Pro");

  return (
    <div className="border-t border-black/[0.06] px-6 pt-4 pb-5">
      {data.tiles.length > 0 && (
        // Die Motive laufen seitlich aus der Karte wie jedes Regal der App. Bewusst KEIN
        // Knopf: Auf dieser Seite ist der Kauf das Ziel, eine Kachel, die etwas anderes
        // öffnet, wäre ein Umweg davon weg.
        <ScrollStrip>
          <div className="flex w-max gap-2.5">
            {data.tiles.map((tile) => (
              <figure key={tile.key} className="w-[76px] shrink-0">
                <LockedMedia
                  previewUrl={tile.previewUrl}
                  className="aspect-[4/5] w-full rounded-[12px]"
                />
                {tile.label && (
                  <figcaption className="mt-1 text-center text-[11px] leading-tight text-balance text-muted">
                    {tile.label}
                  </figcaption>
                )}
              </figure>
            ))}
          </div>
        </ScrollStrip>
      )}

      {/* Die zwei Zahlen, um die es geht. Alle Spots zuerst: Wer kauft, bekommt den ganzen
          Katalog und nicht „die gesperrten" (Empfehlung der Recherche, entschieden
          11.09.2026). Als Zahl + Wort, nicht als Satz: So stimmt die Grammatik in allen
          13 Sprachen, auch dort, wo das Hauptwort mit der Zahl die Form wechselt. */}
      <p className="mt-4 text-center text-[15px] text-ink">
        <span className="whitespace-nowrap">
          <b className="text-[17px] tabular-nums">{data.total}</b> {t("showcaseSpots")}
        </span>
        <span className="mx-2 text-muted/60" aria-hidden>
          ·
        </span>
        <span className="whitespace-nowrap">
          <b className="text-[17px] tabular-nums text-accent">{data.pro}</b> {t("showcaseProOnly")}
        </span>
      </p>
    </div>
  );
}

/**
 * Die Aufschlüsselung je Regal („18 Food Spots, 10 Anspruchsvolle Touren …"), UNTER dem
 * Kaufblock auf /pro. Über dem Preis kostete sie in Deutsch und Französisch vier Zeilen, rund
 * 100 px, und schob den Kauf-Knopf hinter die Tab-Leiste. Hier liest sie, wer weiterliest.
 */
export function ProShowcaseCounts({ data, className = "" }: { data: ProShowcaseData; className?: string }) {
  const t = useTranslations("Pro");
  const tNav = useTranslations("Nav");

  // Winter und Touren hängen hinten an, aber nur, wenn es sie gibt: „0 Audio-Touren" wäre
  // ein Versprechen, das die Seite im selben Satz bricht.
  const counts = [
    ...data.shelves,
    ...(data.winter > 0 ? [{ key: "winter", label: t("showcaseWinter"), count: data.winter }] : []),
    ...(data.tours > 0 ? [{ key: "tours", label: tNav("tours"), count: data.tours }] : []),
  ];
  if (counts.length === 0) return null;

  return (
    // Fliesszeile, Umbruch nur ZWISCHEN den Einträgen: „10 Anspruchsvolle Touren" bleibt
    // beisammen. Ein Zwei-Spalten-Raster war hier probiert und schlechter: Am iPhone brach es
    // die Regal-Namen mitten im Eintrag um („Stadt & / Hausberge") und wurde dadurch sogar
    // höher. Die Regal-Namen kommen in 13 Sprachen aus der Datenbank, deren Länge kennt hier
    // niemand im Voraus.
    <ul className={`flex flex-wrap justify-center gap-x-3 gap-y-1 text-[13px] text-muted ${className}`}>
      {counts.map((c) => (
        <li key={c.key} className="whitespace-nowrap">
          <b className="font-semibold tabular-nums text-ink">{c.count}</b> {c.label}
        </li>
      ))}
    </ul>
  );
}
