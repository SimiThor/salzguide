"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

// Pro-Hinweis für einen gesperrten Stopp in der Tour-Übersicht (TourView.tsx). Er sitzt dort
// IM Peek-Anker des Sheets, also in der Fläche, die auch eingeklappt sichtbar ist: ein
// kurzer Satz und ein Weg weiter, mehr passt dort nicht hin, ohne die halbe Karte zu
// verdecken.
//
// WARUM HIER KEIN KAUFBLOCK STEHT: Er stand hier, und er gehört woanders hin. Der
// Fahrbildschirm der Rad-Navigation braucht den Kauf an Ort und Stelle (ein Seitensprung
// nimmt dort Karte, Route, Ortung und Wake Lock mit), aber er braucht ihn in einem eigenen
// Blatt mit eigener Höhe und fixem Fuß – nav/ArrivalSheet.tsx, `LockedStopSheet`. In den
// Peek-Anker gepresst wuchs derselbe Block das eingeklappte Sheet auf die halbe Seite.
//
// Auf der Übersichtsseite ist der Sprung auf /pro dagegen richtig: Wer hier liest, sitzt
// nicht auf dem Rad, und auf /pro steht, was Pro sonst noch kann.
export default function StopLockedCard({
  freeStops,
  total,
}: {
  freeStops: number;
  total: number;
}) {
  const t = useTranslations("Tours");
  const tPro = useTranslations("Pro");
  return (
    <div className="overflow-hidden rounded-[16px] bg-white/85 shadow-sm ring-1 ring-black/[0.04]">
      <div className="p-4">
        <p className="text-[14px] font-semibold text-ink">🔒 {t("lockedTitle")}</p>
        <p className="mt-1 text-[13px] leading-snug text-muted">
          {t("lockedFree", { free: freeStops, total })}
        </p>
      </div>
      <Link
        href="/pro"
        className="m-4 mt-0 flex items-center justify-center rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-white transition active:scale-[0.98]"
      >
        {tPro("cta")}
      </Link>
    </div>
  );
}
