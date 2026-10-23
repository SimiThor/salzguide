import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppSpotLive } from "./app-api-types";
import { austrianHoliday } from "./holidays-at";
import { computeStatus, viennaNowWM, viennaToday } from "./opening-hours";
import { getSpotOpeningWeekWith } from "./opening-hours-server";
import type { SpotDetail } from "./spots";
import { getLakeReadingByName } from "./water-temp";
import { getWeatherFromToday } from "./weather";

const EMPTY: AppSpotLive = { weather: null, opening: null, waterTemp: null };

/**
 * Wetter, Öffnungszeiten und Wassertemperatur eines Spots für die App (GET /spots/{slug}/live).
 *
 * Rechnet AUSSCHLIESSLICH aus dem maskierten Spot-Detail (loadSpotDetail für den Betrachter):
 * Ein gesperrter Spot liefert dort weder Koordinaten noch googlePlaceId noch lakeName, es gibt
 * also nichts zu berechnen, und Wetter oder Öffnungszeit können den Ort nicht verraten. Die
 * Funktion liest NIE selbst aus der Tabelle spots außer den Öffnungszeiten, und die über den
 * übergebenen Client (RLS wie im Web).
 *
 * Gleiche Bedingungen wie die Spot-Seite im Web (spot/[slug]/page.tsx): Öffnungszeiten bei
 * hasOpeningHours, Wassertemperatur bei lakeName, Wetter nur bei Aktiv-Spots mit Hauptpunkt
 * (Position, sonst Start der Route). Die Quellen und ihr Cache sind dieselben Funktionen.
 * Jeder Teil fällt für sich leer (null) aus, ein Fehler in einer Quelle kippt nicht die anderen.
 */
export async function loadSpotLive(
  spot: SpotDetail,
  client: SupabaseClient | null,
  locale: string,
  now: Date = new Date(),
): Promise<AppSpotLive> {
  if (spot.locked) return EMPTY;

  const main: [number, number] | null =
    spot.lat != null && spot.lng != null
      ? [spot.lat, spot.lng]
      : spot.route && spot.route.length > 0
        ? [spot.route[0][1], spot.route[0][0]]
        : null;

  const [weather, opening, waterTemp] = await Promise.all([
    spot.type === "activity" && main
      ? getWeatherFromToday(main[0], main[1], now).catch(() => null)
      : null,
    spot.hasOpeningHours
      ? getSpotOpeningWeekWith(client, spot.slug, spot.googlePlaceId).catch(() => null)
      : null,
    spot.lakeName ? getLakeReadingByName(spot.lakeName).catch(() => null) : null,
  ]);

  let openingOut: AppSpotLive["opening"] = null;
  if (opening) {
    const status = computeStatus(opening.week, viennaNowWM(now));
    const today = viennaToday(now);
    // Datum jedes Wochentags DIESER Woche (Mo..So), wie SpotOpeningHours im Web.
    const mondayUTC = Date.UTC(today.y, today.m - 1, today.d) - today.weekday * 86_400_000;
    const holidays = Array.from({ length: 7 }, (_, i) => {
      const dt = new Date(mondayUTC + i * 86_400_000);
      return austrianHoliday(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate(), locale);
    });
    openingOut = {
      source: opening.source,
      week: opening.week,
      todayIndex: today.weekday,
      open: status.open,
      changeAt: status.changeAt,
      holidays,
    };
  }

  return {
    weather: weather && weather.length > 0 ? { days: weather } : null,
    opening: openingOut,
    waterTemp:
      waterTemp?.reading
        ? {
            lake: { slug: waterTemp.lake.slug, name: waterTemp.lake.name },
            tempC: waterTemp.reading.tempC,
            at: waterTemp.reading.at,
            source: waterTemp.reading.source,
          }
        : null,
  };
}
