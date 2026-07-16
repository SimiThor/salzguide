// Google-Maps-Deeplink (docs/19). destination = Zielkoordinaten, mode = driving|transit.
export function buildMapsLink(
  lat: number,
  lng: number,
  mode: "driving" | "transit",
): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=${mode}`;
}
