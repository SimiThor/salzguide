// Abstand zweier Linien, für die Vergleichsskripte (routing-compare.ts, spot-routes-compare.ts):
// Hausdorff (grösster Abstand), Mittel, und der Anteil, der höchstens NEAR_M von der anderen
// Linie entfernt liegt, in beide Richtungen. Beide Linien werden alle SAMPLE_M abgetastet.
import { routeCumulativeMeters, toLocalM } from "../../src/lib/geo.ts";
import type { LngLat } from "../../src/lib/routing/types.ts";

export const NEAR_M = 15;
export const SAMPLE_M = 5;

export function sample(line: LngLat[], stepM: number): LngLat[] {
  const cum = routeCumulativeMeters(line);
  const total = cum[cum.length - 1];
  const out: LngLat[] = [];
  let seg = 0;
  for (let d = 0; d <= total; d += stepM) {
    while (seg < line.length - 2 && cum[seg + 1] < d) seg++;
    const len = cum[seg + 1] - cum[seg];
    const f = len > 0 ? (d - cum[seg]) / len : 0;
    out.push([line[seg][0] + (line[seg + 1][0] - line[seg][0]) * f, line[seg][1] + (line[seg + 1][1] - line[seg][1]) * f]);
  }
  return out;
}

export function distToLine(p: [number, number], line: [number, number][]): number {
  let best = Infinity;
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i];
    const b = line[i + 1];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy;
    let t = len2 > 0 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
    if (d < best) best = d;
  }
  return best;
}

export type LineComparison = {
  hausdorffM: number;
  meanM: number;
  /** Anteil der Linie a, der höchstens NEAR_M von b entfernt liegt (und umgekehrt). */
  nearAonB: number;
  nearBonA: number;
  /** Wie viele Meter der Linie a liegen weiter als NEAR_M von b weg? */
  offM: number;
};

export function compareLines(a: LngLat[], b: LngLat[]): LineComparison {
  const lat0 = a[0][1];
  const la = a.map((p) => toLocalM(p, lat0));
  const lb = b.map((p) => toLocalM(p, lat0));
  const da = sample(a, SAMPLE_M).map((p) => distToLine(toLocalM(p, lat0), lb));
  const db = sample(b, SAMPLE_M).map((p) => distToLine(toLocalM(p, lat0), la));
  const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const share = (xs: number[]) => xs.filter((x) => x <= NEAR_M).length / xs.length;
  return {
    hausdorffM: Math.max(...da, ...db),
    meanM: (mean(da) + mean(db)) / 2,
    nearAonB: share(da),
    nearBonA: share(db),
    offM: da.filter((x) => x > NEAR_M).length * SAMPLE_M,
  };
}
