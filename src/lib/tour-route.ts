// Geh-Route einer KURATIERTEN Runde: eine Quelle für die Aktualitäts-Marke und für
// die Prüfung der Geometrie. Läuft identisch auf Client (Formular) und Server
// (Speichern) — wie spot-hash.ts bei den Übersetzungen.
//
// Die Route wird serverseitig bei Mapbox geholt (tour-actions.ts), im Formular
// gehalten und beim Speichern mitgeschickt. Der Hash sagt, AUS WELCHEM STAND sie
// gerechnet wurde: Start + Reihenfolge der Stationen + Ziel. Verschiebt der Admin
// eine Station, weicht der Hash ab und das Formular zeigt „Route veraltet".
import { hashTexts } from "./spot-hash";

export type RoutePoint = { lat: number; lng: number };

// 5 Nachkommastellen ≈ 1 m: genau genug, um ein Verschieben des Startpunkts zu
// erkennen, grob genug, dass Fliesskomma-Rauschen keine falsche Warnung auslöst.
const coord = (c: RoutePoint | null): string =>
  c && Number.isFinite(c.lat) && Number.isFinite(c.lng)
    ? `${c.lat.toFixed(5)},${c.lng.toFixed(5)}`
    : "-";

export function tourRouteHash(input: {
  start: RoutePoint | null;
  end: RoutePoint | null;
  pointIds: string[];
}): string {
  return hashTexts([coord(input.start), ...input.pointIds, coord(input.end)]);
}

// Obergrenze gegen Datenmüll in der Zeile: eine Altstadt-Runde hat ein paar hundert
// Stützpunkte, alles darüber ist kein Fussweg mehr.
const MAX_POINTS = 10000;

/**
 * Geometrie aus fremder Hand (Formular-State) auf das Format [lng,lat][] festnageln.
 * Gibt null zurück, wenn irgendetwas nicht stimmt — lieber keine Linie als eine
 * kaputte, die die Karte quer über den Globus zieht.
 */
export function cleanRouteGeo(value: unknown): [number, number][] | null {
  if (!Array.isArray(value) || value.length < 2 || value.length > MAX_POINTS) return null;
  const out: [number, number][] = [];
  for (const item of value) {
    if (!Array.isArray(item) || item.length !== 2) return null;
    const [lng, lat] = item as [unknown, unknown];
    if (typeof lng !== "number" || typeof lat !== "number") return null;
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
    if (lng < -180 || lng > 180 || lat < -90 || lat > 90) return null;
    out.push([lng, lat]);
  }
  return out;
}
