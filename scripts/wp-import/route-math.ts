// Rechnerei rund um eine Wanderlinie, gemeinsam für alle Import-Skripte.
//
// WARUM EIGENE DATEI: `downsample` und `ascentDescent` standen wortgleich in routes.ts UND
// import.ts. Zwei Kopien derselben Formel sind genau die zweite Wahrheit, vor der die
// README beim Import warnt: Sie laufen auseinander, sobald jemand nur eine davon anfasst,
// und die Datei, die dann falsch rechnet, sieht genauso richtig aus wie vorher.
//
// Die Gehzeit-Formel, `ascentDescent` und die Dauer-Schreibweise stehen NICHT hier, sondern
// in `src/lib/geo.ts`, weil der Admin sie beim Snappen ebenfalls braucht. Hier steht nur,
// was um sie herum passiert; die drei werden weitergereicht, damit die Import-Skripte ihre
// gewohnten Namen behalten und trotzdem nur EINE Fassung existiert.
import { routeLengthKm } from "../../src/lib/geo.ts";

export { ascentDescent, formatHikingDuration as formatDuration } from "../../src/lib/geo.ts";
// Eindampfen und Höhenprofil: seit docs/42 in lib/elevation.ts, weil der Admin-Kern
// (routing/snap-spot.ts) dieselbe Rechnung braucht. Hier nur weitergereicht.
export { downsample, buildElevationProfile as elevationProfile } from "../../src/lib/elevation.ts";
import { downsample } from "../../src/lib/elevation.ts";

/**
 * Hin und zurück auf demselben Weg: Aus dem Aufstieg wird beim Rückweg der Abstieg und
 * umgekehrt, deshalb ist beides danach die Summe. Exakt, nicht geschätzt, weil der Rückweg
 * derselbe Weg ist.
 */
export function doubled(km: number, ascent: number, descent: number) {
  return { km: km * 2, ascent: ascent + descent, descent: ascent + descent };
}

/**
 * Die Linie selbst hin und zurück legen, wortgleich zu `makeThereAndBack` im Admin-Formular
 * (`[...pts, ...pts.slice(0, -1).reverse()]`). Der letzte Punkt darf nicht doppelt
 * vorkommen, sonst hat die Route eine Länge von null an der Wende.
 */
export function thereAndBack<T>(pts: T[]): T[] {
  return [...pts, ...pts.slice(0, -1).reverse()];
}

/**
 * Kontrollpunkte für das Admin-Formular. Die Rohlinie hat bis zu 1447 Punkte; das Formular
 * fällt ohne route_waypoints auf die gezeichnete Linie zurück und zeigte dann 1447 einzeln
 * ziehbare Punkte an. Handgezeichnete Routen im Altbestand hatten 3 bis 21, also wird auf
 * diese Grössenordnung eingedampft: einer alle ~400 m, mindestens 4, höchstens 20.
 */
export function waypointsFor(coords: [number, number][]): [number, number][] {
  const km = routeLengthKm(coords);
  const target = Math.max(4, Math.min(20, Math.round((km * 1000) / 400)));
  return downsample(coords, target);
}
