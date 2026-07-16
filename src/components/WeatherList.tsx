import type { WeatherDay } from "@/lib/weather";
import { bcp47 } from "@/i18n/locales";
import { kindForCode, WeatherGlyph, isWetCode, RAIN } from "./weather-icons";

// Vertikale Wetter-Liste im Apple-iOS-2026-Stil (Mobile + Desktop):
// luftige Zeilen mit viel Abstand, Wochentag, Icon (+ Regen-% darunter bei Regen)
// und einem kompakten Temperatur-Bereichsbalken (Tages-Min–Max in der Wochenspanne).
export default function WeatherList({
  days,
  today,
  todayISO,
  locale,
}: {
  days: WeatherDay[];
  today: string;
  todayISO: string; // heutiges Datum (Europe/Vienna) YYYY-MM-DD – robust nach Mitternacht
  locale: string;
}) {
  const wd = new Intl.DateTimeFormat(bcp47(locale), {
    weekday: "short",
    timeZone: "Europe/Vienna",
  });
  const lo = Math.min(...days.map((d) => d.tempMin));
  const hi = Math.max(...days.map((d) => d.tempMax));
  const span = Math.max(1, hi - lo);

  return (
    <div className="divide-y divide-black/[0.06]">
      {days.map((d) => {
        const isToday = d.date === todayISO; // echtes Datum statt Position
        const left = ((d.tempMin - lo) / span) * 100;
        const right = ((hi - d.tempMax) / span) * 100;
        return (
          <div
            key={d.date}
            className="flex items-center justify-between gap-6 py-4 sm:gap-4"
          >
            <span
              className={`w-12 shrink-0 text-[15px] font-normal ${
                isToday ? "text-accent" : "text-ink/90"
              }`}
            >
              {isToday ? today : wd.format(new Date(`${d.date}T12:00:00Z`))}
            </span>

            {/* Icon + Regenwahrscheinlichkeit darunter – nur bei Regen (wie Apple) */}
            <span className="flex min-h-[42px] w-8 shrink-0 flex-col items-center justify-center gap-1">
              <WeatherGlyph kind={kindForCode(d.code)} size={26} />
              {isWetCode(d.code) && (
                <span
                  className="text-[11px] font-semibold leading-none"
                  style={{ color: RAIN }}
                >
                  {d.precip}%
                </span>
              )}
            </span>

            {/* Temperatur-Bereich: Tief – Balken – Hoch.
                iPhone: füllt die Restbreite (kein Leerraum). Desktop: fester breiter Balken. */}
            <div className="flex flex-1 items-center gap-3 sm:flex-none">
              <span className="w-9 shrink-0 text-right text-[16px] text-muted">
                {d.tempMin}°
              </span>
              <div className="relative h-2 flex-1 rounded-full bg-black/[0.07] sm:w-80 sm:flex-none">
                <div
                  className="absolute inset-y-0 rounded-full bg-gradient-to-r from-[#7fb2e6] to-[#f2a03e]"
                  style={{ left: `${left}%`, right: `${right}%` }}
                />
              </div>
              <span className="w-9 shrink-0 text-right text-[16px] font-semibold text-ink">
                {d.tempMax}°
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
