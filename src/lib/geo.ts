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
