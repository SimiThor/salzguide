"use client";

import SpotCard from "@/components/SpotCard";
import { useProGate } from "@/components/ProGate";

// Die gesperrte Karte im Regal – als Knopf, der den Pro-Hinweis öffnet (ProGate).
//
// Warum eine eigene Komponente und kein onClick an der Aufrufstelle: Die Regale stehen in
// Server-Komponenten (Spot-Seite, Startseite). Genau diese eine Karte muss auf den Client,
// der Rest des Regals – die freien Karten mit ihren echten Links – bleibt Server-HTML für
// Crawler und Erstbild.
//
// KEIN TITEL, KEIN SLUG über die Client-Grenze: Beide sind bei gesperrten Spots ohnehin
// serverseitig ersetzt ("Geheimer Spot", `locked-<i>`), und die Karte zeigt sie im
// gesperrten Zustand nicht an. Was eine Client-Komponente als Prop bekommt, steht im
// ausgelieferten Payload – da gehört nichts hinein, was niemand braucht.
export default function LockedSpotCard({
  previewUrl,
  emoji,
  lockedLabel,
  unlockLabel,
  sizeClassName,
  sizes,
  eager,
}: {
  previewUrl?: string | null;
  emoji?: string | null;
  /** „🤫 Geheimtipp" – Abzeichen auf der Karte und im Hinweis. */
  lockedLabel: string;
  /** Was der Tipp bewirkt, für Screenreader (z.B. „SalzGuide Pro freischalten"). */
  unlockLabel: string;
  sizeClassName?: string;
  sizes?: string;
  eager?: boolean;
}) {
  const gate = useProGate();

  return (
    // sg-tap-card: dasselbe Einsinken beim Klick wie bei den Karten auf der Startseite –
    // am Touch bewusst nichts, weil die Karte im Scroll-Weg des Karussells liegt.
    // aria-label statt des Karten-Inhalts: Vorgelesen würde sonst „••••• •••".
    <button
      type="button"
      onClick={() => gate.show({ previewUrl, emoji, label: lockedLabel })}
      aria-label={unlockLabel}
      className="cursor-pointer sg-tap-card block text-left"
    >
      <SpotCard
        title=""
        emoji={emoji}
        previewUrl={previewUrl}
        isPro
        locked
        lockedLabel={lockedLabel}
        sizeClassName={sizeClassName}
        sizes={sizes}
        eager={eager}
      />
    </button>
  );
}
