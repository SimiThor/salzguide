"use client";

import LockedMedia from "@/components/LockedMedia";
import ScrollStrip from "@/components/ScrollStrip";

// Die Motive auf der Pro-Seite: echte Pro-Spots, verschwommen, als Bilderstreifen direkt unter
// der Überschrift.
//
// WARUM BILDER UND KAUM ZAHLEN: Pro ist ein Gefühlskauf („die Plätze, an denen du sonst
// vorbeifährst"), kein Tarifvergleich. Die erste Fassung (09/2026) hatte eine Zahlenzeile und
// darunter eine Aufschlüsselung je Regal. Anton fand das zu zahlenlastig, zu Recht: Eine
// Paywall, die sich wie eine Tabelle liest, verkauft Bestand statt Lust. Übrig ist EINE Zahl,
// und die steckt im Bild: Die letzte Kachel zeigt „+67", so wie jedes Fotoalbum zeigt, dass es
// weitergeht. Ohne Wort daneben, deshalb in allen 13 Sprachen gleich.
//
// Die Recherche zum Pro-Schnitt (Studie über 21 Nachrichtenseiten aus DE/AT): Verschwommene
// Bilder kosten keine Abschlüsse, beschreibender Text schon. Deshalb steht auf jedem Motiv nur
// die ART (Klamm, Café), nie der Ort: Das Ortsfeld eines Spots ist die Gemeinde, und Art plus
// Gemeinde wäre in einer Minute ergoogelt.

/**
 * Die Daten für den Streifen. Der Typ steht HIER und nicht in lib/pro-showcase.ts: Diese Datei
 * läuft im Browser, jene auf dem Server. Was beide brauchen, gehört auf die Browser-Seite, der
 * Server importiert von hier. Umgekehrt reisst ein Import aus einer Server-Datei das
 * Browser-Bündel mit, und tsc merkt davon nichts.
 */
export type ProShowcaseData = {
  /** Alle Pro-Spots. Daraus rechnet die letzte Kachel ihr „+N". */
  pro: number;
  /** Verschwommene Motive, je eines aus einem anderen Regal. Das letzte trägt das „+N". */
  tiles: { key: string; previewUrl: string | null; label: string | null }[];
};

export default function ProShowcase({ data }: { data: ProShowcaseData }) {
  if (data.tiles.length === 0) return null;
  // N zählt alles, was nicht als eigenes Motiv zu sehen ist, die letzte Kachel eingeschlossen.
  const withLabel = data.tiles.length - 1;
  const more = data.pro - withLabel;

  return (
    // Keine Haarlinie darüber: Überschrift und Bilder sind EIN Block, die Motive zeigen, wovon
    // die Überschrift spricht. Die Linie kommt erst vor dem Preis.
    //
    // aria-hidden: Der Streifen ist Stimmung, keine Information. Was er sagt, sagt die
    // Überschrift darüber schon, und „Klamm, Schifffahrt, plus 67" vorgelesen hilft niemandem.
    <div className="px-6 pb-5" aria-hidden>
      <ScrollStrip>
        {/* pb-2: Platz für den Schatten, sonst schneidet ihn der Streifen unten ab. Die Breite
            ist so gewählt, dass am iPhone drei Motive ganz und vom vierten ein Stück zu sehen
            sind: Das Stück ist die Einladung zum Wischen. */}
        <div className="flex w-max gap-2.5 pb-2">
          {data.tiles.map((tile, i) => {
            const isMore = i === data.tiles.length - 1 && more > 0;
            return (
              // isolate + transform-gpu wie in LockedMedia: Nur so schneidet Safari die runden
              // Ecken sauber, obwohl darin ein Bild mit blur()-Filter liegt.
              <figure
                key={tile.key}
                className="relative isolate w-[92px] shrink-0 transform-gpu overflow-hidden rounded-[16px] shadow-[0_8px_18px_-12px_rgba(0,0,0,0.5)]"
              >
                <LockedMedia previewUrl={tile.previewUrl} className="aspect-[4/5] w-full" />
                {isMore ? (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/35">
                    <span className="text-[24px] font-bold tracking-tight text-white tabular-nums">
                      +{more}
                    </span>
                  </div>
                ) : (
                  tile.label && (
                    // hyphens-auto + break-words: „Bergwanderung" ist breiter als die Kachel, und
                    // ein einzelnes Wort bricht der Browser sonst nicht um. Es stand abgeschnitten
                    // als „Bergwanderun" da. Silbentrennung nach der Seitensprache (html lang),
                    // break-words als Netz, falls eine Sprache keine Trennregeln kennt.
                    <figcaption className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/55 to-transparent px-2 pt-6 pb-2 text-[12px] font-semibold leading-tight text-balance break-words hyphens-auto text-white">
                      {tile.label}
                    </figcaption>
                  )
                )}
              </figure>
            );
          })}
        </div>
      </ScrollStrip>
    </div>
  );
}
