import { cachedJson } from "./api-cache";

export type WeatherDay = {
  date: string; // YYYY-MM-DD (lokale Zeitzone des Spots)
  tempMax: number;
  tempMin: number;
  precip: number; // Regenwahrscheinlichkeit %
  code: number; // WMO-Wettercode
};

// 7-Tage-Vorschau für einen Punkt via Open-Meteo (gratis, kein Key, EU).
// Koordinaten auf 2 Nachkommastellen (~1km-Raster) -> nahe Spots teilen einen
// Cache-Eintrag; 24h-Cache -> max. 1 externer Call pro Zelle & Tag (kosteneffizient).
export async function getWeather(
  lat: number,
  lon: number,
): Promise<WeatherDay[] | null> {
  const rlat = lat.toFixed(2);
  const rlon = lon.toFixed(2);
  const key = `weather:${rlat},${rlon}`;

  return cachedJson<WeatherDay[]>(key, 86400, async () => {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${rlat}&longitude=${rlon}` +
      `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max` +
      `&timezone=auto&forecast_days=7`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`open-meteo ${res.status}`);
    const j = await res.json();
    const d = j?.daily;
    if (!d || !Array.isArray(d.time)) throw new Error("open-meteo malformed");
    return (d.time as string[]).slice(0, 7).map((date, i) => ({
      date,
      tempMax: Math.round(d.temperature_2m_max?.[i] ?? 0),
      tempMin: Math.round(d.temperature_2m_min?.[i] ?? 0),
      precip: Math.round(d.precipitation_probability_max?.[i] ?? 0),
      code: (d.weather_code?.[i] as number) ?? 0,
    }));
  });
}

// Aktuelles Kalenderdatum in Europe/Vienna als YYYY-MM-DD. Alle Spots liegen im
// Salzburger Land -> feste Zeitzone. WICHTIG: nie die lokale Serverzeit nehmen
// (Vercel läuft in UTC) -> sonst kippt „heute" zur falschen Zeit.
export function viennaDateISO(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Vienna",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

// Gecachtes 7-Tage-Wetter, aber IMMER ab HEUTE (Vienna). Die Rohdaten werden 24h
// gecacht -> der erste Eintrag kann nach Mitternacht schon „gestern" sein. Hier
// werden vergangene Tage beim Verbrauch (nicht im Cache) verworfen, damit Labels
// wie heute/morgen/Wochentag überall robust zum echten Datum passen. So bleibt
// der Cache kosteneffizient (1 externer Call/Tag) UND das Datum stimmt.
export async function getWeatherFromToday(
  lat: number,
  lon: number,
  now: Date = new Date(),
): Promise<WeatherDay[] | null> {
  const days = await getWeather(lat, lon);
  if (!days) return null;
  const todayISO = viennaDateISO(now);
  const fromToday = days.filter((d) => d.date >= todayISO);
  // Fallback: sollten (extrem selten) alle Tage in der Vergangenheit liegen,
  // lieber die Rohdaten liefern als nichts – die Labels sind datumsbasiert eh korrekt.
  return fromToday.length ? fromToday : days;
}
