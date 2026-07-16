import { getTranslations } from "next-intl/server";
import { bcp47 } from "@/i18n/locales";
import { getSpotOpeningWeek } from "@/lib/opening-hours-server";
import {
  computeStatus,
  fmtMin,
  viennaNowWM,
  viennaToday,
  type DayHours,
} from "@/lib/opening-hours";
import { austrianHoliday } from "@/lib/holidays-at";

const CARD =
  "rounded-[18px] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_32px_-20px_rgba(0,0,0,0.28)]";

// Async Server-Component: holt (gecachte) Öffnungszeiten – Google oder manuell –
// und rendert Status ("jetzt geöffnet") + Wochenliste (heute hervorgehoben).
// Feiertage der aktuellen Woche werden exakt berechnet und am Tag angeschrieben.
export default async function SpotOpeningHours({
  spot,
  locale,
}: {
  spot: { slug: string; googlePlaceId: string | null };
  locale: string;
}) {
  const info = await getSpotOpeningWeek(spot.slug, spot.googlePlaceId);
  if (!info) return null;
  const { week, source } = info;

  const t = await getTranslations({ locale, namespace: "Detail.opening" });
  const now = new Date();
  const nowWM = viennaNowWM(now);
  const status = computeStatus(week, nowWM);
  const today = viennaToday(now);
  const todayIdx = today.weekday;

  const dayFmt = new Intl.DateTimeFormat(bcp47(locale), {
    weekday: "long",
  });
  const refMon = Date.UTC(2024, 0, 1); // 1.1.2024 = Montag
  const dayName = (i: number) =>
    dayFmt.format(new Date(refMon + i * 86_400_000));

  // Datum jedes Wochentags DIESER Woche (Mo..So) -> Feiertag exakt bestimmen.
  const mondayUTC =
    Date.UTC(today.y, today.m - 1, today.d) - todayIdx * 86_400_000;
  const holidayFor = (i: number): string | null => {
    const dt = new Date(mondayUTC + i * 86_400_000);
    return austrianHoliday(
      dt.getUTCFullYear(),
      dt.getUTCMonth() + 1,
      dt.getUTCDate(),
      locale,
    );
  };

  const is24 = week.every(
    (d) =>
      !d.closed &&
      d.ranges.length === 1 &&
      d.ranges[0].open === "00:00" &&
      d.ranges[0].close === "24:00",
  );

  let secondary = "";
  if (status.changeAt != null) {
    const cDay = Math.floor(status.changeAt / 1440);
    const cTime = fmtMin(status.changeAt);
    secondary = status.open
      ? t("closes", { time: cTime })
      : cDay === todayIdx
        ? t("opensToday", { time: cTime })
        : t("opens", { day: dayName(cDay), time: cTime });
  }

  // Geschlossen (Ruhetag oder keine Zeiten) -> ausgeschrieben.
  const dayText = (d: DayHours) =>
    d.ranges.length
      ? d.ranges.map((r) => `${r.open}–${r.close}`).join(", ")
      : t("closed");

  return (
    <section className={`${CARD} p-5`}>
      <h2 className="mb-3 text-[17px] font-semibold text-ink">{t("title")}</h2>

      <div className="mb-3 flex flex-wrap items-center gap-2 text-[15px]">
        <span
          className={`inline-block h-2 w-2 rounded-full ${
            status.open ? "bg-[#2fae5e]" : "bg-[#c0554f]"
          }`}
          aria-hidden
        />
        <span
          className={`font-semibold ${status.open ? "text-[#1f9a4e]" : "text-accent"}`}
        >
          {status.open ? t("open") : t("closed")}
        </span>
        {is24 ? (
          <span className="text-muted">· {t("open24")}</span>
        ) : (
          secondary && <span className="text-muted">· {secondary}</span>
        )}
      </div>

      {!is24 && (
        <div className="divide-y divide-black/[0.06]">
          {week.map((d, i) => {
            const isToday = i === todayIdx;
            const holiday = holidayFor(i);
            const closed = d.ranges.length === 0;
            return (
              <div
                key={i}
                className="flex items-start justify-between gap-3 py-2 text-[15px]"
              >
                <span className="leading-tight">
                  <span className={isToday ? "font-semibold text-ink" : "text-ink/90"}>
                    {dayName(i)}
                  </span>
                  {/* Feiertag minimalistisch wie Google Maps */}
                  {holiday && (
                    <span className="block text-[12px] font-medium text-accent">
                      {holiday}
                    </span>
                  )}
                </span>
                <span
                  className={
                    closed
                      ? "text-muted"
                      : isToday
                        ? "font-semibold text-ink"
                        : "text-muted"
                  }
                >
                  {dayText(d)}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Attribution – Google verlangt "Powered by Google" bei Places-Daten
          außerhalb einer Google-Karte. Nur im Google-Modus, nicht bei manuell. */}
      {source === "google" && (
        <p className="mt-3 text-[11px] text-muted">Powered by Google</p>
      )}
    </section>
  );
}
