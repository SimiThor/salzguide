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
import { haversineMeters, routeLengthKm } from "../../src/lib/geo.ts";

export { ascentDescent, formatHikingDuration as formatDuration } from "../../src/lib/geo.ts";
import { ascentDescent } from "../../src/lib/geo.ts";

/** Gleichmässig auf n Punkte eindampfen, erster und letzter bleiben. */
export function downsample<T>(arr: T[], n: number): T[] {
  if (arr.length <= n) return arr;
  const out: T[] = [];
  const step = (arr.length - 1) / (n - 1);
  for (let i = 0; i < n; i++) out.push(arr[Math.round(i * step)]);
  return out;
}

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

/**
 * Format wie Migration 0006 und wie snapRoute es schreibt:
 * { points:[{d(km), e(m)}], ascent, descent, min, max, distanceKm }, Punkte bei 100 gedeckelt.
 */
export function elevationProfile(coords: [number, number][], el: number[]) {
  const pts: { d: number; e: number }[] = [];
  let cum = 0;
  for (let i = 0; i < coords.length; i++) {
    if (i > 0) cum += haversineMeters(coords[i - 1], coords[i]);
    pts.push({ d: cum / 1000, e: el[i] });
  }
  const { ascent, descent } = ascentDescent(el);
  return {
    points: downsample(pts, 100).map((p) => ({ d: Math.round(p.d * 100) / 100, e: Math.round(p.e) })),
    ascent,
    descent,
    min: Math.round(Math.min(...el)),
    max: Math.round(Math.max(...el)),
    distanceKm: cum / 1000,
  };
}
