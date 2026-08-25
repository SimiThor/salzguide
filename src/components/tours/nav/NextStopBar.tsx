"use client";

import { useTranslations } from "next-intl";
import { formatNavDistanceM } from "@/lib/nav-format";

// Untere HUD-Leiste: zwei Blöcke, die bewusst getrennt bleiben. Links der nächste Halt mit
// der Entfernung DORTHIN, rechts die ganze Runde mit Restweg und Ankunft.
//
// WAS HIER FALSCH WAR: Der Name des nächsten Stopps stand über der Beschriftung "Bis zum
// Ziel", während die Zahl daneben die Restdistanz der GANZEN Runde war. Am Gerät las sich
// das als "Apothekerhofstraße, bis zum Ziel 8,4 km", obwohl die Apothekerhofstraße 240 m
// entfernt war und die 8,4 km für die Runde galten. Zwei Zahlen, zwei Bezüge, eine Zeile:
// Jede für sich stimmte, zusammen ergaben sie eine Falschaussage.
export default function NextStopBar({
  stopEmoji,
  stopTitle,
  // Entfernung bis zum nächsten Halt, entlang der Route. null, wenn keiner mehr offen ist.
  toStopM,
  // Restweg der gesamten Runde.
  remainingM,
  etaMin,
}: {
  stopEmoji: string | null;
  stopTitle: string | null;
  toStopM: number | null;
  remainingM: number;
  etaMin: number | null;
}) {
  const t = useTranslations("Tours");
  return (
    <div className="sg-nav-card pointer-events-none flex items-center justify-between gap-4 rounded-[22px] px-4 py-3">
      <span className="min-w-0 flex-1">
        {stopTitle ? (
          <>
            <span className="block truncate text-[15px] font-bold text-ink">
              {stopEmoji ? `${stopEmoji} ` : ""}
              {stopTitle}
            </span>
            <span className="block text-[12px] text-muted">
              {toStopM != null && toStopM > 0
                ? t("navNextStopIn", { distance: formatNavDistanceM(toStopM) })
                : t("navNextStop")}
            </span>
          </>
        ) : (
          // Alle Stopps gehört oder passiert: Dann trägt die linke Seite nur noch die
          // Aussage, dass es zurück zum Ausgangspunkt geht.
          <span className="block truncate text-[15px] font-bold text-ink">{t("navToFinish")}</span>
        )}
      </span>

      <span className="shrink-0 text-right">
        <span className="block text-[17px] font-bold tabular-nums text-ink">
          {formatNavDistanceM(remainingM)}
        </span>
        <span className="block text-[11px] text-muted">
          {etaMin != null ? `${t("navEta")} ${t("minutes", { count: etaMin })}` : t("navRemaining")}
        </span>
      </span>
    </div>
  );
}
