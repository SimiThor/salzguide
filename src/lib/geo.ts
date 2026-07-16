// Geo-Helfer (client-safe). Koordinaten sind [lng, lat].

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
