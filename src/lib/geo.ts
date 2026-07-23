// Geo-Helfer (client-safe). Koordinaten sind [lng, lat].

// Ein gesetzter Karten-Punkt (Wasserstelle / Hütte): Koordinaten + optionaler Name +
// optionaler Untertyp-Code. name ist absichtlich frei und einsprachig (DE-Basis, wie
// route_waypoints) — es sind Eigennamen ("Stögeralm") oder kurze Orte, keine UI-Texte.
// subtype ist ein sprachneutraler Code (z.B. "fountain") aus src/lib/poi.ts; das
// dargestellte Label wird daraus lokalisiert.
export type MapPoi = { lng: number; lat: number; name?: string; subtype?: string };

// Robust aus jsonb ODER aus dem Formular-Array lesen. Wird bewusst auf BEIDEN Seiten
// benutzt (DB-Lesen und Speichern-Säubern), damit nie Halbgares in die DB oder auf die
// Karte kommt: nur echte Zahlen, Name/Untertyp getrimmt, leere fallen weg, kaputte
// Punkte werden verworfen. Akzeptiert auch die Tupel-Form [lng,lat] (defensiv).
export function parsePois(v: unknown): MapPoi[] {
  if (!Array.isArray(v)) return [];
  const out: MapPoi[] = [];
  for (const item of v) {
    let lng: unknown, lat: unknown, name: unknown, subtype: unknown;
    if (Array.isArray(item)) {
      [lng, lat] = item;
    } else if (item && typeof item === "object") {
      ({ lng, lat, name, subtype } = item as Record<string, unknown>);
    } else {
      continue;
    }
    if (typeof lng !== "number" || typeof lat !== "number") continue;
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
    const cleanName = typeof name === "string" ? name.trim() : "";
    const cleanSub = typeof subtype === "string" ? subtype.trim() : "";
    const poi: MapPoi = { lng, lat };
    if (cleanName) poi.name = cleanName;
    if (cleanSub) poi.subtype = cleanSub;
    out.push(poi);
  }
  return out;
}

export function haversineMeters(a: [number, number], b: [number, number]): number {
  const R = 6371000;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// Gesamtlänge einer Route in Kilometern (Haversine-Summe). Fallback für die Distanz, wenn
// kein Höhenprofil vorliegt (dort steckt sonst elevation.distanceKm). Route ist [lng,lat].
export function routeLengthKm(route: [number, number][] | null | undefined): number {
  if (!route || route.length < 2) return 0;
  let m = 0;
  for (let i = 1; i < route.length; i++) m += haversineMeters(route[i - 1], route[i]);
  return m / 1000;
}

// --- Realistische Tour-Dauer (DAV-Gehzeit + Pausen) ------------------------------------
// Ziel: eine ehrliche Zeit für einen NORMALEN Wanderer (kein Sportler), die die Höhenmeter
// wirklich mitrechnet UND normale Pausen (Foto, Jause) einschließt. ORS' foot-hiking-Dauer
// war dafür zu optimistisch (rechnet Berge zu schwach ein). Wir rechnen stattdessen selbst.
//
// Reine Gehzeit nach der im Alpenraum üblichen DAV-/DIN-33466-Methode:
//   - 4 km/h in der Ebene (Wander-, kein Marschtempo)
//   - 300 Höhenmeter/Stunde im Aufstieg
//   - 500 Höhenmeter/Stunde im Abstieg
//   - Horizontal- und Vertikalzeit überlagern sich nur teilweise: die GRÖSSERE der beiden
//     zählt voll, die kleinere nur zur Hälfte.
// Darauf ein Pausen-Puffer von ~10 Min/Stunde -> realistische Tour-Dauer, wie sie ein
// normaler Wanderer wirklich braucht (reine Gehzeit wäre für die echte Tour zu optimistisch).
//
// Hin & zurück und Rundwege sind automatisch abgedeckt, weil die VOLLE Route eingegeben wird
// (mit Auf- UND Abstieg): der Rückweg bringt seine eigenen Höhen-/Streckenmeter mit.
export const HIKE_SPEED_KMH = 4;
export const HIKE_ASCENT_MH = 300;
export const HIKE_DESCENT_MH = 500;
export const HIKE_BREAK_MIN_PER_HOUR = 10; // Pausen-Puffer auf die reine Gehzeit

export function hikingTimeMinutes(
  distanceKm: number,
  ascentM: number,
  descentM: number,
): number {
  const km = Math.max(0, distanceKm || 0);
  const up = Math.max(0, ascentM || 0);
  const down = Math.max(0, descentM || 0);
  const tHoriz = km / HIKE_SPEED_KMH; // Stunden
  const tVert = up / HIKE_ASCENT_MH + down / HIKE_DESCENT_MH; // Stunden
  const gehzeitHours = Math.max(tHoriz, tVert) + 0.5 * Math.min(tHoriz, tVert);
  const withBreaks = gehzeitHours * (1 + HIKE_BREAK_MIN_PER_HOUR / 60);
  return Math.round(withBreaks * 60);
}

// Punkt auf der Route bei Bruchteil f ∈ [0..1] der Gesamtlänge (interpoliert).
export function coordAtFraction(
  route: [number, number][],
  f: number | null,
): [number, number] | null {
  if (!route || route.length === 0 || f == null) return null;
  if (route.length === 1) return route[0];
  const clamped = Math.max(0, Math.min(1, f));

  // Segmentlängen + Gesamtlänge
  let total = 0;
  const segs: number[] = [];
  for (let i = 1; i < route.length; i++) {
    const d = haversineMeters(route[i - 1], route[i]);
    segs.push(d);
    total += d;
  }
  if (total === 0) return route[0];

  const target = clamped * total;
  let acc = 0;
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i];
    if (acc + seg >= target) {
      const t = seg === 0 ? 0 : (target - acc) / seg;
      const a = route[i];
      const b = route[i + 1];
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }
    acc += seg;
  }
  return route[route.length - 1];
}

// ——— Routen-Form: einordnen (EINE Quelle für Karte UND Wander-Animation) ————————————
// Drei Fälle, robust und mit Messtoleranz:
//  - "point-to-point": Start und Ziel weit auseinander (z.B. Gipfel einfach).
//  - "loop":           Start ≈ Ziel, aber der Weg läuft NICHT doppelt (echter Rundweg).
//  - "out-and-back":   Start ≈ Ziel UND die Rückhälfte ist der umgekehrte Hinweg (hin/retour).
// Trägt der Admin hin+zurück ein (damit Länge/Höhe/Dauer stimmen), fallen Start und Ziel
// zusammen: die Karte zeigt dann nur EINEN Pin, und die Story-Animation zeigt bei hin/retour
// nur den Hinweg (Rückweg wäre langweilig), beim Rundweg den ganzen Weg.

// Start/Ziel gelten als "gleiche Stelle", wenn näher als das. Bewusst absolut (kein relativer
// Anteil, der bei langen Punkt-zu-Punkt-Wegen zu locker würde).
const CLOSED_TOL_M = 120;
// hin/retour: mittlerer Abstand der gefalteten Hälften darunter -> deckungsgleich (Toleranz
// gegen Snapping-Jitter). Ein Rundweg (Hälften auf gegenüberliegenden Seiten) liegt weit drüber.
const OUT_AND_BACK_TOL_M = 30;

export type RouteShape = "point-to-point" | "loop" | "out-and-back";

// Liegen Start und Ziel (fast) auf derselben Stelle? (Leichtgewichtig, für die Karten-Pins.)
export function isClosedRoute(route: [number, number][] | null | undefined): boolean {
  const n = route?.length ?? 0;
  if (!route || n < 3) return false;
  return haversineMeters(route[0], route[n - 1]) <= CLOSED_TOL_M;
}

function cumulativeMeters(route: [number, number][]): number[] {
  const out = [0];
  for (let i = 1; i < route.length; i++) {
    out.push(out[i - 1] + haversineMeters(route[i - 1], route[i]));
  }
  return out;
}

// [lng,lat] in ein lokales Meter-System um lat0 (klein genug für Wander-Ausdehnungen).
function toLocalM([lng, lat]: [number, number], lat0: number): [number, number] {
  const mPerDegLat = 110540;
  const mPerDegLng = 111320 * Math.cos((lat0 * Math.PI) / 180);
  return [lng * mPerDegLng, lat * mPerDegLat];
}

// Abstand Punkt<->Segment in Metern (lokal projiziert).
function pointSegDistM(p: [number, number], a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

// Mittlerer nächster Abstand von Stichproben auf A zur Polylinie B (Meter).
function meanNearestDistM(
  a: [number, number][],
  b: [number, number][],
  samples: number,
  lat0: number,
): number {
  if (a.length < 1 || b.length < 2) return Infinity;
  const bl = b.map((p) => toLocalM(p, lat0));
  const step = Math.max(1, Math.floor(a.length / samples));
  let sum = 0;
  let count = 0;
  for (let i = 0; i < a.length; i += step) {
    const pl = toLocalM(a[i], lat0);
    let best = Infinity;
    for (let j = 1; j < bl.length; j++) {
      const d = pointSegDistM(pl, bl[j - 1], bl[j]);
      if (d < best) best = d;
    }
    sum += best;
    count++;
  }
  return count ? sum / count : Infinity;
}

// Die Route einordnen. turnaroundIndex = Wendepunkt (Distanz-Mitte) bei hin/retour, sonst der
// letzte Punkt (= ganze Route).
export function classifyRoute(route: [number, number][] | null | undefined): {
  shape: RouteShape;
  turnaroundIndex: number;
  closed: boolean;
} {
  const n = route?.length ?? 0;
  if (!route || n < 4) {
    return { shape: "point-to-point", turnaroundIndex: Math.max(0, n - 1), closed: false };
  }
  const last = n - 1;
  if (!isClosedRoute(route)) return { shape: "point-to-point", turnaroundIndex: last, closed: false };

  // In der Distanz-Mitte falten: bei exaktem hin/retour ist das der Wendepunkt.
  const cum = cumulativeMeters(route);
  const total = cum[last];
  if (total <= 0) return { shape: "loop", turnaroundIndex: last, closed: true };
  const halfDist = total / 2;
  let mid = 1;
  while (mid < last && cum[mid] < halfDist) mid++;
  if (mid < 2 || mid > last - 2) return { shape: "loop", turnaroundIndex: last, closed: true };

  const outbound = route.slice(0, mid + 1);
  const inbound = route.slice(mid).reverse(); // Wendepunkt -> Start, umgedreht wie der Hinweg
  const lat0 = route[0][1];
  const worst = Math.max(
    meanNearestDistM(outbound, inbound, 48, lat0),
    meanNearestDistM(inbound, outbound, 48, lat0),
  );
  return worst <= OUT_AND_BACK_TOL_M
    ? { shape: "out-and-back", turnaroundIndex: mid, closed: true }
    : { shape: "loop", turnaroundIndex: last, closed: true };
}

// Die zu animierende Route: bei hin/retour nur der Hinweg, sonst die ganze Route
// (Rundweg + Punkt-zu-Punkt). Für die Story-/Intro-Animation.
export function outboundRoute(route: [number, number][]): [number, number][] {
  const { shape, turnaroundIndex } = classifyRoute(route);
  return shape === "out-and-back" ? route.slice(0, turnaroundIndex + 1) : route;
}
