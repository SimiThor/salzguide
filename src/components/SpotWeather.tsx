import { getTranslations } from "next-intl/server";
import { getWeatherFromToday, viennaDateISO } from "@/lib/weather";
import WeatherList from "./WeatherList";

const CARD =
  "rounded-[18px] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_32px_-20px_rgba(0,0,0,0.28)]";

// Async Server-Component: lädt das (gecachte) 7-Tage-Wetter und rendert einen
// ruhigen Tages-Streifen im iOS-Stil. Kein Wetter -> nichts.
export default async function SpotWeather({
  lat,
  lon,
  locale,
  title,
  today,
}: {
  lat: number;
  lon: number;
  locale: string;
  title: string;
  today: string;
}) {
  const now = new Date();
  const days = await getWeatherFromToday(lat, lon, now);
  if (!days || days.length === 0) return null;
  const todayISO = viennaDateISO(now);
  const tc = await getTranslations({ locale, namespace: "Common" });

  return (
    <section className={`${CARD} p-5`}>
      <h2 className="mb-4 text-[17px] font-semibold text-ink">{title}</h2>
      {/* Apple-Liste auf allen Größen – übersichtlich, gut ablesbar. */}
      <WeatherList days={days} today={today} todayISO={todayISO} locale={locale} />
      {/* Attribution – Open-Meteo (CC BY 4.0) */}
      <p className="mt-3 text-[11px] text-muted">
        <a
          href="https://open-meteo.com/"
          target="_blank"
          rel="noopener noreferrer"
          className="hover:underline"
        >
          {tc("weatherSource")}: Open-Meteo.com
        </a>
      </p>
    </section>
  );
}
