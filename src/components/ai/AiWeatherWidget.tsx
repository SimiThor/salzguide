"use client";

import { useLocale, useTranslations } from "next-intl";
import { bcp47 } from "@/i18n/locales";
import { Link } from "@/i18n/navigation";
import {
  WeatherGlyph,
  kindForCode,
  isWetCode,
  RAIN,
} from "@/components/weather-icons";
import type { AiWeather } from "@/lib/ai-types";

// Minimalistisches Wetter-Widget im Chat. 2 Tage (heute/morgen) für einen Spot ODER
// bis 7 Tage (Wochenvorschau, „bester Tag?"). Gleiche Icons wie auf der Spot-Seite.
// Mit Spot-slug ist die ganze Kachel zur Spot-Seite verlinkt (volle Vorschau).
export default function AiWeatherWidget({
  weather,
  onNavigate,
}: {
  weather: AiWeather;
  onNavigate?: () => void;
}) {
  const t = useTranslations("Ai");
  const locale = useLocale();
  const dl = bcp47(locale);
  const days = weather.days.slice(0, 7);
  if (!days.length) return null;

  // Labels datumsbasiert (nicht per Index) in Europe/Vienna bestimmen -> „Heute"/
  // „Morgen" stimmen auch, wenn der 24h-Cache nach Mitternacht noch von gestern ist.
  const viennaISO = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Vienna",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
  const nowD = new Date();
  const todayISO = viennaISO(nowD);
  const tomorrowISO = viennaISO(new Date(nowD.getTime() + 86_400_000));

  const label = (dateStr: string) => {
    if (dateStr === todayISO) return t("today");
    if (dateStr === tomorrowISO) return t("tomorrow");
    const d = new Date(`${dateStr}T12:00:00Z`);
    return Number.isNaN(d.getTime())
      ? ""
      : d.toLocaleDateString(dl, { weekday: "short", timeZone: "Europe/Vienna" });
  };

  const body = (
    <>
      <div className="mb-2 flex items-center justify-between">
        <span className="truncate text-[12px] font-semibold text-muted">
          {t("weatherTitle")}
          {weather.name ? ` · ${weather.name}` : ""}
        </span>
        {weather.slug && (
          <span className="text-[15px] leading-none text-muted" aria-hidden>
            ›
          </span>
        )}
      </div>
      <div className="flex gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {days.map((d) => (
          <div
            key={d.date}
            className="flex min-w-[3rem] flex-1 flex-col items-center gap-1 rounded-[12px] bg-black/[0.02] py-2.5"
          >
            <span className="text-[11px] font-medium text-muted">{label(d.date)}</span>
            <WeatherGlyph kind={kindForCode(d.code)} size={24} />
            <span className="whitespace-nowrap text-[13px] font-semibold text-ink">
              {d.maxC}°<span className="ml-0.5 font-normal text-muted">{d.minC}°</span>
            </span>
            {isWetCode(d.code) && (
              <span className="text-[10px] font-semibold" style={{ color: RAIN }}>
                {d.rainProbPct}%
              </span>
            )}
          </div>
        ))}
      </div>
      <p className="mt-2 text-[10px] text-muted">{t("attrWeather")}</p>
    </>
  );

  const cls =
    "block rounded-[16px] bg-white p-3 shadow-[0_1px_3px_rgba(0,0,0,0.04),0_8px_24px_-12px_rgba(0,0,0,0.12)] ring-1 ring-black/[0.04]";

  return weather.slug ? (
    <Link
      href={`/spot/${weather.slug}`}
      onClick={onNavigate}
      className={`${cls} transition active:scale-[0.99]`}
    >
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}
