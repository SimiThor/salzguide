import "server-only";

import { bearingBetween, haversineMeters } from "../geo";
import { assertRoutable } from "./brouter";
import { finishRoute, type RawManeuver } from "./normalize";
import type { LngLat, NormalizedRoute, RouteRequest, RoutingProvider } from "./types";

// Testadapter für Entwicklung, Prüfskripte und CI (wie Kraxelbande): verbindet die Punkte
// GERADLINIG und setzt an jedem Knick ein Manöver. Kein echter Weg, deshalb gekennzeichnet
// (source.provider "local", data "Testadapter") und in Produktion nie still aktiv; darüber
// wacht getRoutingProvider().

const STEP_M = 20;

function modifierFor(angle: number): RawManeuver["modifier"] {
  const a = Math.abs(angle);
  const side = angle < 0 ? "left" : "right";
  if (a >= 170) return "uturn";
  if (a >= 120) return `sharp ${side}`;
  return a >= 35 ? side : `slight ${side}`;
}

export class LocalRoutingProvider implements RoutingProvider {
  readonly name = "local" as const;

  async route({ points, mode, labels, profile }: RouteRequest): Promise<NormalizedRoute> {
    assertRoutable(points);
    const raw: LngLat[] = [points[0]];
    const corners: number[] = [];
    for (let k = 1; k < points.length; k++) {
      const [a, b] = [points[k - 1], points[k]];
      const n = Math.max(1, Math.round(haversineMeters(a, b) / STEP_M));
      for (let s = 1; s <= n; s++) raw.push([a[0] + ((b[0] - a[0]) * s) / n, a[1] + ((b[1] - a[1]) * s) / n]);
      if (k < points.length - 1) corners.push(raw.length - 1);
    }
    const maneuvers: RawManeuver[] = [];
    for (const i of corners) {
      const angle = ((bearingBetween(raw[i], raw[i + 1]) - bearingBetween(raw[i - 1], raw[i]) + 540) % 360) - 180;
      if (Math.abs(angle) >= 20) maneuvers.push({ index: i, type: "turn", modifier: modifierFor(angle), angleDeg: angle });
    }
    return finishRoute({
      rawGeometry: raw,
      maneuvers,
      points,
      durationS: null,
      ascentM: null,
      source: {
        provider: "local",
        profile: profile ?? mode,
        engine: null,
        data: "Testadapter",
        attribution: "Testadapter ohne echte Wegdaten",
        computedAt: new Date().toISOString(),
      },
      warnings: ["Testadapter: Die Linie folgt keinem echten Weg."],
      labels,
    });
  }
}
