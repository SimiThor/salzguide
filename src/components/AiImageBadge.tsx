"use client";

import { useTranslations } from "next-intl";
import AiSparkle from "./ai/AiSparkle";
import type { AiOrigin } from "@/lib/ai-origin";

// DAS eine sichtbare KI-Label für Bilder (Art. 50 KI-VO; Einstufung und wann welches
// Label pflichtig bzw. freiwillig ist: docs/39_RECHT_KI-Transparenz.md §5).
// Stil folgt der Haus-Konvention für Overlays auf Fotos (LockedMedia-Pille):
// dunkles Glas, klein, nicht anklickbar. Der Sparkle ist das Marken-KI-Zeichen
// (AiSparkle.tsx), hier in currentColor = weiss auf dunkler Pille.
//
// data-ai-origin macht das Label zusätzlich maschinenlesbar, dasselbe Muster wie
// data-ai-generated an den Chat-Antworten (AiMessage.tsx).
//
// `className` trägt Positionierung UND Display (Standard: rechts unten, absolut,
// inline-flex). Das Display steht bewusst NICHT in der Basisklasse: Der Hero labelt je
// <picture>-Variante mit `hidden md:inline-flex`, und ein `inline-flex` in der Basis
// würde das `hidden` je nach CSS-Reihenfolge überstimmen (Klassen-Reihenfolge im HTML
// zählt nicht, die Reihenfolge im Stylesheet entscheidet). Für den Textfluss
// (Lightbox-Kopf) einfach className="inline-flex" geben.
export default function AiImageBadge({
  origin,
  className = "absolute bottom-1.5 right-1.5 z-10 inline-flex",
}: {
  origin: AiOrigin;
  className?: string;
}) {
  const t = useTranslations("AiMedia");
  return (
    <span
      data-ai-origin={origin}
      className={`pointer-events-none items-center gap-1 rounded-full bg-black/45 px-2 py-[3px] text-[10px] font-semibold leading-none text-white backdrop-blur-md ${className}`}
    >
      <AiSparkle className="h-[11px] w-[11px]" />
      {t(origin)}
    </span>
  );
}
