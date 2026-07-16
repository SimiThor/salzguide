"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import type { AiOpening } from "@/lib/ai-types";

// Kompaktes Öffnungszeiten-Widget: Status (geöffnet/geschlossen) + heutige Zeiten,
// klickbar zur Spot-Seite (volle Wochenübersicht). Google-Attribution, wenn die
// Daten von Google Places stammen (source='google').
export default function AiOpeningWidget({
  opening,
  onNavigate,
}: {
  opening: AiOpening;
  onNavigate?: () => void;
}) {
  const t = useTranslations("Ai");
  return (
    <Link
      href={`/spot/${opening.slug}`}
      onClick={onNavigate}
      className="block rounded-[16px] bg-white p-3 shadow-[0_1px_3px_rgba(0,0,0,0.04),0_8px_24px_-12px_rgba(0,0,0,0.12)] ring-1 ring-black/[0.04] transition active:scale-[0.99]"
    >
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-semibold text-muted">{t("openingTitle")}</span>
        <span className="text-[15px] leading-none text-muted" aria-hidden>
          ›
        </span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[12px] font-semibold ${
            opening.openNow ? "bg-emerald-500/10 text-emerald-700" : "bg-black/[0.05] text-muted"
          }`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${opening.openNow ? "bg-emerald-500" : "bg-muted"}`}
            aria-hidden
          />
          {opening.openNow ? t("openNow") : t("closedNow")}
        </span>
        <span className="text-[13px] text-ink">{opening.todayHours}</span>
      </div>
      {opening.source === "google" && (
        <p className="mt-2 text-[10px] text-muted">{t("attrGoogle")}</p>
      )}
    </Link>
  );
}
