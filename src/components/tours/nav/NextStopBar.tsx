"use client";

import { useTranslations } from "next-intl";
import { formatNavDistanceM } from "@/lib/nav-format";

// Untere HUD-Leiste: welcher Stopp kommt, wie weit noch, wann ungefähr. Ruhiger als der
// Abbiege-Banner (der ist die Handlung JETZT), deshalb kleinere Schrift und keine
// Akzentfarbe – nur der Titel des Stopps sticht heraus.
export default function NextStopBar({
  stopEmoji,
  stopTitle,
  distanceM,
  etaMin,
}: {
  stopEmoji: string | null;
  stopTitle: string;
  distanceM: number;
  etaMin: number | null;
}) {
  const t = useTranslations("Tours");
  return (
    <div className="pointer-events-none flex items-center justify-between gap-3 rounded-[22px] bg-white/90 px-4 py-3 shadow-[0_8px_28px_-10px_rgba(0,0,0,0.35)] backdrop-blur-xl">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-bold text-ink">
          {stopEmoji ? `${stopEmoji} ` : ""}
          {stopTitle}
        </span>
        <span className="block text-[12px] text-muted">{t("navRemaining")}</span>
      </span>
      <span className="shrink-0 text-right">
        <span className="block text-[17px] font-bold tabular-nums text-ink">
          {formatNavDistanceM(distanceM)}
        </span>
        {etaMin != null && (
          <span className="block text-[11px] text-muted">
            {t("navEta")} {t("minutes", { count: etaMin })}
          </span>
        )}
      </span>
    </div>
  );
}
