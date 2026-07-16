"use client";

import { useLocale, useTranslations } from "next-intl";
import { bcp47 } from "@/i18n/locales";
import { Link } from "@/i18n/navigation";
import type { WaterReading } from "@/lib/ai-types";

// Wassertemperatur-Widget – gleicher iOS-Karten-Look wie Wetter/Öffnungszeiten:
// weiße Karte (p-3, rounded-16), gedämpftes Label + Chevron, weiche Zellen. Die
// ganze Kachel linkt zur vollen Übersicht. Attribution: Land Salzburg · AGES.
export default function AiWaterChips({
  readings,
  onNavigate,
}: {
  readings: WaterReading[];
  onNavigate?: () => void;
}) {
  const locale = useLocale();
  const tNav = useTranslations("Nav");
  const t = useTranslations("Ai");
  const dl = bcp47(locale);
  const fmtDate = (at: string) => {
    const d = new Date(at);
    return Number.isNaN(d.getTime())
      ? null
      : d.toLocaleDateString(dl, { day: "numeric", month: "short" });
  };

  return (
    <Link
      href="/wasser"
      onClick={onNavigate}
      className="block rounded-[16px] bg-white p-3 shadow-[0_1px_3px_rgba(0,0,0,0.04),0_8px_24px_-12px_rgba(0,0,0,0.12)] ring-1 ring-black/[0.04] transition active:scale-[0.99]"
    >
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-semibold text-muted">{tNav("water")}</span>
        <span className="text-[15px] leading-none text-muted" aria-hidden>
          ›
        </span>
      </div>
      <div className="mt-2 space-y-1.5">
        {readings.map((r) => {
          const date = fmtDate(r.at);
          return (
            <div
              key={r.slug}
              className="flex items-baseline justify-between gap-3 rounded-[12px] bg-black/[0.02] px-3 py-2"
            >
              <span className="min-w-0 truncate text-[13px] text-ink">
                {r.name}
                {date && <span className="ml-1.5 text-[11px] text-muted">{date}</span>}
              </span>
              <span className="shrink-0 text-[15px] font-semibold tabular-nums text-ink">
                {r.tempC.toLocaleString(dl, { maximumFractionDigits: 1 })}°
              </span>
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-[10px] text-muted">{t("attrWater")}</p>
    </Link>
  );
}
