// ═══════════════════════════════════════════════════════════════════════════════════
//  TESTHAKEN – NICHT DAUERHAFT.
//
//  Eine eigene, erfundene S-Bike-Testrunde, KOMPLETT getrennt von "Antons Hausrunde":
//  eigener Slug, eigener Titel, eigene Stationen – nicht dieselbe Tour mit
//  umgeschaltetem `mode` wie im ersten Anlauf. Sie existiert NICHT in der Datenbank
//  und braucht keine Migration/keinen Admin-Zugriff:
//
//    - Stationen: ECHTE Adressen im Salzburger Stadtteil Parsch (Koordinaten aus
//      OpenStreetMap/Nominatim), damit ein Live-GPS-Test vor Ort sinnvoll ist.
//    - Verbindungslinie: eine ECHTE Strecke je Etappe (Mapbox Directions), NICHT
//      pauschal das "cycling"-Profil: In Parsch sind mehrere kurze Rad-/Fusswege
//      nicht als radtauglich getaggt, wodurch "cycling" allein wilde Umwege über die
//      Hauptstrasse nimmt (gemessen: Apothekerhofstraße -> Maria-Cebotari-Straße 160m
//      Luftlinie, aber 1747m mit "cycling" statt 345m mit "walking" über denselben
//      Fussweg). Deshalb je Etappe BEIDE Profile abfragen und das kürzere nehmen –
//      "Radwege und sogar Fusswege", wie gewünscht. Betrifft nur diese Vorschau-Linie
//      auf der Tour-Seite, nicht die Live-Navigation (die routet für sich selbst,
//      siehe bike-directions.ts).
//    - Vertonung: 1:1 von "Antons Hausrunde" übernommen (dieselben Signed-URLs,
//      Texte, Dauer, Pro-Gate) – nur Ort und Titel sind neu.
//    - Erreichbar NUR über einen kleinen Link im Footer (LegalFooter.tsx), NICHT über
//      die normale Tourenliste (getPublishedTours liest weiter nur echte DB-Zeilen) –
//      damit echte Nutzer die unfertige Seite noch nicht finden.
//
//  ENTFERNEN, sobald es eine echte S-Bike-Runde gibt: diese Datei, lib/test-sbike-
//  slug.ts, ihre Aufrufstellen in touren/[slug]/page.tsx und
//  touren/[slug]/navigation/page.tsx, und der Footer-Link in LegalFooter.tsx.
// ═══════════════════════════════════════════════════════════════════════════════════
import { getTourDetail } from "./tours";
import { cleanRouteGeo } from "./tour-route";
import { TEST_SBIKE_SLUG } from "./test-sbike-slug";
import type { TourDetail, TourStopView } from "./tour-types";

export { TEST_SBIKE_SLUG };

// Echte Adressen in Salzburg-Parsch, per Nominatim/OpenStreetMap nachgeschlagen –
// keine erfundenen Koordinaten. Reihenfolge wie vorgegeben (die alte Station 5 steht
// jetzt vorne). Station 2 liegt auf der Maria-Cebotari-Straße, auf dem Weg von
// Apothekerhofstraße zur VS Abfalter (nicht auf Dr.-Petter-Straße, das führt in die
// falsche Richtung). Station 3 ist ein Punkt AUF DER STRASSE vor der Schule (die
// Hausnummer Dr.-Petter-Straße 21), nicht der Gebäude-Mittelpunkt der VS Abfalter
// selbst – sonst läge der Punkt im Gebäude statt am Weg.
const PARSCH_POINTS: { lat: number; lng: number; name: string }[] = [
  { lat: 47.8001734, lng: 13.0781937, name: "Apothekerhofstraße" },
  { lat: 47.8001489, lng: 13.0803381, name: "Maria-Cebotari-Straße" },
  { lat: 47.7983173, lng: 13.0821909, name: "VS Abfalter" },
  { lat: 47.8023191, lng: 13.0692697, name: "Gaisbergstraße" },
  { lat: 47.7993946, lng: 13.0731008, name: "Ludwig-Zeller-Weg" },
];

const SOURCE_SLUG = "antons-hausrunde";

type LegResult = { geo: [number, number][]; distanceM: number };

// Eine Etappe (zwei Punkte) in EINEM Mapbox-Profil abfragen. null bei jedem Fehler.
async function fetchLeg(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
  profile: "cycling" | "walking",
  token: string,
): Promise<LegResult | null> {
  const coordStr = `${a.lng},${a.lat};${b.lng},${b.lat}`;
  const url =
    `https://api.mapbox.com/directions/v5/mapbox/${profile}/${coordStr}` +
    `?geometries=geojson&overview=full&access_token=${token}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return null;
    const j = await res.json();
    const route = Array.isArray(j.routes) ? j.routes[0] : null;
    const geo = cleanRouteGeo(route?.geometry?.coordinates);
    if (j.code !== "Ok" || !route || !geo) return null;
    return { geo, distanceM: route.distance };
  } catch {
    return null;
  }
}

// Je Etappe "cycling" UND "walking" abfragen und das KÜRZERE nehmen (Begründung oben).
// Alle Etappen parallel, beide Profile parallel – das sind maximal 2×(n-1) Anfragen für
// eine Handvoll Stationen, kein Problem für eine Vorschau-Linie. Anschliessend werden
// die Etappen-Geometrien aneinandergereiht; der gemeinsame Übergangspunkt zweier
// Etappen würde sonst doppelt in der Linie stehen.
async function fetchEfficientRoute(
  points: { lat: number; lng: number }[],
): Promise<[number, number][] | null> {
  const token = process.env.MAPBOX_SERVER_TOKEN ?? process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  if (!token || points.length < 2) return null;

  const legs = await Promise.all(
    points.slice(0, -1).map(async (a, i) => {
      const b = points[i + 1];
      const [cycling, walking] = await Promise.all([
        fetchLeg(a, b, "cycling", token),
        fetchLeg(a, b, "walking", token),
      ]);
      if (!cycling && !walking) return null;
      if (!cycling) return walking;
      if (!walking) return cycling;
      return walking.distanceM < cycling.distanceM ? walking : cycling;
    }),
  );
  if (legs.some((l) => l == null)) return null;

  const combined: [number, number][] = [];
  for (const leg of legs as LegResult[]) {
    const geo = combined.length ? leg.geo.slice(1) : leg.geo; // Übergangspunkt nicht doppeln
    combined.push(...geo);
  }
  return combined;
}

export async function getTestSBikeTour(locale: string): Promise<TourDetail | null> {
  // Vertonung (Signed-URLs, Texte, Dauer, Pro-Gate) 1:1 von der echten Runde holen –
  // nur die Koordinaten/Titel unten werden ersetzt.
  const source = await getTourDetail(SOURCE_SLUG, locale);
  if (!source) return null;

  const n = Math.min(PARSCH_POINTS.length, source.stops.length);
  const stops: TourStopView[] = source.stops.slice(0, n).map((s, i) => ({
    ...s,
    title: PARSCH_POINTS[i].name,
    lat: PARSCH_POINTS[i].lat,
    lng: PARSCH_POINTS[i].lng,
  }));

  const routeGeo = await fetchEfficientRoute(PARSCH_POINTS.slice(0, n));

  return {
    ...source,
    slug: TEST_SBIKE_SLUG,
    mode: "bike",
    title: "🚲 Testrunde Parsch",
    subtitle: "Testdaten: echte Orte in Parsch, Vertonung von Antons Hausrunde übernommen.",
    stopCount: stops.length,
    stops,
    routeGeo,
    start: { lat: PARSCH_POINTS[0].lat, lng: PARSCH_POINTS[0].lng },
    end: null,
  };
}
