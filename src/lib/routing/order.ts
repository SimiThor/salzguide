// Reihenfolge der Stopps einer eigenen Runde (KI-Builder): ab dem Start alle Stopps und
// zurück zum Start, kürzeste Luftlinie. Rein und ohne Server-Teil, damit die Prüfskripte sie
// gegen die rohe Gewalt (alle Reihenfolgen) rechnen können.
//
// Bis 23.10.2026 bestimmte Mapbox Optimization die Reihenfolge; deren Ergebnisse dürfen
// nicht gespeichert werden (docs/42, Abschnitt 0). Für höchstens EXACT_MAX Stopps rechnen wir
// exakt (Held-Karp über alle Teilmengen, 2^10 * 10 * 10 Schritte), darüber Nächster-Nachbar
// mit 2-opt. Bei Gleichstand gewinnt immer der kleinere Index: Dieselbe Eingabe ergibt
// dieselbe Runde, auch auf einem anderen Rechner.
import { haversineMeters } from "../geo";
import type { LngLat } from "./types";

/** Bis hierhin exakt. Der Builder lässt höchstens 8 Stopps zu (tour-generate.ts). */
export const EXACT_MAX = 10;

/** Indizes von `stops` in Besuchsreihenfolge (Start und Rückweg sind nicht enthalten). */
export function orderLoop(start: LngLat, stops: LngLat[]): number[] {
  const n = stops.length;
  if (n <= 1) return stops.map((_, i) => i);
  const pts = [start, ...stops];
  const d: number[][] = pts.map((a) => pts.map((b) => haversineMeters(a, b)));
  return n <= EXACT_MAX ? exact(d, n) : improve(d, n, nearest(d, n));
}

/** Rundenlänge in Metern (Luftlinie) für eine Reihenfolge, ab Start und zurück. */
export function loopLengthM(start: LngLat, stops: LngLat[], order: number[]): number {
  let m = 0;
  let cur = start;
  for (const i of order) {
    m += haversineMeters(cur, stops[i]);
    cur = stops[i];
  }
  return m + haversineMeters(cur, start);
}

// Held-Karp: best[mask][j] = kürzester Weg vom Start über genau die Stopps in `mask`, der bei
// Stopp j endet (j ist in mask). Stopp-Index 0..n-1 entspricht Punkt 1..n in d.
function exact(d: number[][], n: number): number[] {
  const full = (1 << n) - 1;
  const best = new Float64Array((full + 1) * n).fill(Infinity);
  const prev = new Int16Array((full + 1) * n).fill(-1);
  for (let j = 0; j < n; j++) best[(1 << j) * n + j] = d[0][j + 1];
  for (let mask = 1; mask <= full; mask++) {
    for (let j = 0; j < n; j++) {
      if (!(mask & (1 << j))) continue;
      const cur = best[mask * n + j];
      if (!Number.isFinite(cur)) continue;
      for (let k = 0; k < n; k++) {
        if (mask & (1 << k)) continue;
        const next = mask | (1 << k);
        const cost = cur + d[j + 1][k + 1];
        if (cost < best[next * n + k]) {
          best[next * n + k] = cost;
          prev[next * n + k] = j;
        }
      }
    }
  }
  let endJ = 0;
  let endCost = Infinity;
  for (let j = 0; j < n; j++) {
    const cost = best[full * n + j] + d[j + 1][0];
    if (cost < endCost) {
      endCost = cost;
      endJ = j;
    }
  }
  const order: number[] = [];
  let mask = full;
  let j = endJ;
  while (j >= 0) {
    order.push(j);
    const p = prev[mask * n + j];
    mask &= ~(1 << j);
    j = p;
  }
  return order.reverse();
}

function nearest(d: number[][], n: number): number[] {
  const left = new Set(Array.from({ length: n }, (_, i) => i));
  const order: number[] = [];
  let cur = 0;
  while (left.size) {
    let pick = -1;
    let pickD = Infinity;
    for (const i of left) {
      if (d[cur][i + 1] < pickD) {
        pickD = d[cur][i + 1];
        pick = i;
      }
    }
    order.push(pick);
    left.delete(pick);
    cur = pick + 1;
  }
  return order;
}

// 2-opt auf der geschlossenen Runde (Punkt 0 = Start bleibt fest).
function improve(d: number[][], n: number, order: number[]): number[] {
  const tour = [0, ...order.map((i) => i + 1), 0];
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 1; i < tour.length - 2; i++) {
      for (let k = i + 1; k < tour.length - 1; k++) {
        const before = d[tour[i - 1]][tour[i]] + d[tour[k]][tour[k + 1]];
        const after = d[tour[i - 1]][tour[k]] + d[tour[i]][tour[k + 1]];
        if (after < before - 1e-6) {
          tour.splice(i, k - i + 1, ...tour.slice(i, k + 1).reverse());
          changed = true;
        }
      }
    }
  }
  return tour.slice(1, -1).map((p) => p - 1);
}
