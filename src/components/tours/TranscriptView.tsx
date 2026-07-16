"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

// Sprechtext zum Mitlesen – iOS-Stil: kompakte VORSCHAU (3 Zeilen) mit „Weiterlesen",
// damit die Stopp-Liste sichtbar bleibt. Kurze Texte werden direkt ganz gezeigt.
export default function TranscriptView({ text }: { text: string }) {
  const t = useTranslations("Tours");
  const [expanded, setExpanded] = useState(false);

  const clean = text.trim();
  const paras = clean
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  const words = clean ? clean.split(/\s+/).length : 0;
  const collapsible = words > 45; // kurze Texte brauchen kein Ausklappen
  const showFull = expanded || !collapsible;

  return (
    <div>
      {showFull ? (
        <div className="sg-reader">
          {(paras.length ? paras : [clean]).map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
      ) : (
        // Vorschau: ganzer Text als ein Block, auf 3 Zeilen begrenzt.
        <p className="sg-reader line-clamp-3">{clean}</p>
      )}
      {collapsible && (
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="mt-1.5 text-[14px] font-semibold text-accent transition active:opacity-70"
        >
          {expanded ? t("readLess") : t("readMore")}
        </button>
      )}
    </div>
  );
}
