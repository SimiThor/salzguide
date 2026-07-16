import "server-only";
import { cachedJson } from "./api-cache";
import { createClient } from "./supabase/server";
import {
  normalizeGoogleNew,
  normalizeManual,
  type OpeningWeek,
} from "./opening-hours";

// Places API (New): Place Details.
// currentOpeningHours = tatsächliche Zeiten der nächsten 7 Tage INKL. Feiertags-
// Anpassungen (Google pflegt AT-Feiertage) -> wartungsfrei. Fallback: regulär.
async function fetchGoogleWeek(placeId: string): Promise<OpeningWeek> {
  const res = await fetch(
    `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}?languageCode=de`,
    {
      headers: {
        "X-Goog-Api-Key": process.env.GOOGLE_PLACES_KEY!,
        "X-Goog-FieldMask": "regularOpeningHours,currentOpeningHours",
      },
      signal: AbortSignal.timeout(8000),
    },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`places(new) http ${res.status} ${body.slice(0, 140)}`);
  }
  const j = await res.json();
  const week =
    normalizeGoogleNew(j?.currentOpeningHours?.periods) ??
    normalizeGoogleNew(j?.regularOpeningHours?.periods);
  if (!week) throw new Error("places(new): keine opening_hours");
  return week;
}

// Öffnungszeiten für einen Spot beschaffen. Manuell = direkt; Google = gecacht
// (pro Place-ID, 7 Tage TTL -> max. 1 externer Call pro Spot & Woche, nicht pro User).
export async function getOpeningWeek(spot: {
  openingHoursManual: boolean;
  openingHours: unknown;
  googlePlaceId: string | null;
}): Promise<OpeningWeek | null> {
  if (spot.openingHoursManual) return normalizeManual(spot.openingHours);

  const placeId = spot.googlePlaceId?.trim();
  if (!placeId || !process.env.GOOGLE_PLACES_KEY) return null; // kein Key/ID -> stiller Fallback
  // 24 h TTL: täglich frisch (currentOpeningHours bleibt aktuell), max. 1 Google-
  // Call pro Spot & Tag, nicht pro Besucher. Cache-Key mit v2 (Format geändert).
  return cachedJson<OpeningWeek>(
    `places:hours:v2:${placeId}`,
    24 * 3600,
    () => fetchGoogleWeek(placeId),
  );
}

// Quelle mitliefern -> für die Attribution (Google verlangt "Powered by Google",
// wenn Places-Daten außerhalb einer Google-Karte gezeigt werden).
export type OpeningResult = { week: OpeningWeek; source: "google" | "manual" };

// Migrationssicher: liest die (neuen) opening_hours-Spalten separat & fehlertolerant,
// damit die öffentliche Spot-Seite nie bricht, falls die Migration noch nicht lief.
export async function getSpotOpeningWeek(
  slug: string,
  googlePlaceId: string | null,
): Promise<OpeningResult | null> {
  let openingHoursManual = false;
  let openingHours: unknown = null;
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("spots")
      .select("opening_hours_manual, opening_hours")
      .eq("slug", slug)
      .maybeSingle();
    if (!error && data) {
      openingHoursManual = Boolean(data.opening_hours_manual);
      openingHours = data.opening_hours;
    }
    // Fehler (z. B. Spalten noch nicht migriert) -> Defaults -> Google-Fallback
  } catch {
    /* ignore -> Defaults */
  }
  const week = await getOpeningWeek({
    openingHoursManual,
    openingHours,
    googlePlaceId,
  });
  if (!week) return null;
  return { week, source: openingHoursManual ? "manual" : "google" };
}
