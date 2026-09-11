"use client";

import LockedMedia from "@/components/LockedMedia";
import { useProGate } from "@/components/ProGate";
import type { ProGateSurface } from "@/lib/pro-gate-track";

// Die kleine Schwester von LockedSpotCard: nur das Blur-Motiv, als Knopf, der den
// Pro-Hinweis öffnet (ProGate).
//
// Warum nicht LockedSpotCard in klein: Die Karte trägt ihr „🤫 Geheimtipp"-Abzeichen im Bild
// und darunter eine verschwommene Titelzeile. Bei drei Kacheln nebeneinander (je ~100px am
// iPhone) passt das Abzeichen nicht mehr ins Bild, und die Titelzeile wäre Rauschen. Hier
// steht das Wort in der Überschrift darüber, die Kachel ist nur das Motiv.
//
// Wie bei LockedSpotCard gilt: Über die Client-Grenze geht nur, was die Kachel zeigt. Kein
// Titel, kein Slug, keine Lage.
export default function LockedTile({
  previewUrl,
  lockedLabel,
  unlockLabel,
  from,
}: {
  previewUrl: string | null;
  /** „🤫 Geheimtipp" – erscheint im Pro-Hinweis, nicht auf der Kachel. */
  lockedLabel: string;
  /** Was der Tipp bewirkt, für Screenreader (z.B. „SalzGuide Pro freischalten"). */
  unlockLabel: string;
  from: ProGateSurface;
}) {
  const gate = useProGate();

  return (
    <button
      type="button"
      onClick={() => gate.show({ previewUrl, label: lockedLabel, from })}
      aria-label={unlockLabel}
      className="sg-tap-card block w-full cursor-pointer text-left"
    >
      <LockedMedia previewUrl={previewUrl} className="aspect-[4/5] w-full rounded-[14px]" />
    </button>
  );
}
