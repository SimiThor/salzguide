// Kuratierte Liste der Salzburger Bade-Seen für die Wassertemperatur.
// Bewusst als Konstante (kein DB-Table) -> keine Migration, wartungsfrei.
//   szg  = exakter "Gewässer"-Name in den Land-Salzburg-Rohdaten (Echtzeit, bevorzugt)
//   ages = "BADEGEWAESSERNAME" in den AGES-Badegewässer-Daten (Fallback + kleinere Seen)
// Koordinaten stammen aus den AGES-Daten (offizielle Messstellen).

export type Lake = {
  slug: string;
  name: string;
  lat: number;
  lng: number;
  szg?: string;
  ages: string;
};

export const LAKES: Lake[] = [
  { slug: "fuschlsee", name: "Fuschlsee", lat: 47.7943, lng: 13.2984, szg: "Fuschlsee", ages: "Fuschlsee, Fuschl" },
  { slug: "wolfgangsee", name: "Wolfgangsee", lat: 47.7688, lng: 13.3686, szg: "Wolfgangsee", ages: "Wolfgangsee, St. Gilgen" },
  { slug: "wallersee", name: "Wallersee", lat: 47.9039, lng: 13.1441, szg: "Wallersee", ages: "Wallersee, Seekirchen" },
  { slug: "mattsee", name: "Mattsee", lat: 47.9741, lng: 13.1077, szg: "Mattsee", ages: "Mattsee, Mattsee" },
  { slug: "obertrumer-see", name: "Obertrumer See", lat: 47.9683, lng: 13.0807, szg: "Obertrumer See", ages: "Obertrumer See, Seeham" },
  { slug: "grabensee", name: "Grabensee", lat: 47.9966, lng: 13.0964, szg: "Grabensee", ages: "Grabensee, Perwang" },
  { slug: "zeller-see", name: "Zeller See", lat: 47.3269, lng: 12.7999, szg: "Zeller See", ages: "Zeller See, Zell am See" },
  { slug: "ritzensee", name: "Ritzensee", lat: 47.4187, lng: 12.8469, ages: "Ritzensee, Saalfelden" },
  { slug: "hintersee", name: "Hintersee (Faistenau)", lat: 47.7492, lng: 13.2517, ages: "Hintersee" },
  { slug: "waldbad-anif", name: "Waldbad Anif", lat: 47.7335, lng: 13.081, ages: "Waldbad Anif" },
  { slug: "lieferinger-badesee", name: "Lieferinger Badesee", lat: 47.8381, lng: 13.0164, ages: "Lieferinger Badesee, Salzburg" },
  { slug: "badesee-gastein", name: "Badesee Gastein", lat: 47.1439, lng: 13.123, ages: "Badesee Gastein, Bad Hofgastein" },
  { slug: "goldegger-see", name: "Goldegger See", lat: 47.3175, lng: 13.1036, ages: "Goldegger See" },
  { slug: "boendlsee", name: "Böndlsee", lat: 47.3141, lng: 13.0418, ages: "Böndlsee, Goldegg" },
  { slug: "prebersee", name: "Prebersee", lat: 47.1849, lng: 13.8558, ages: "Prebersee, Tamsweg" },
];

// See per (Admin-)Freitext-Namen finden – für das Detail-Modul (spot.lake_name).
export function findLake(lakeName: string | null | undefined): Lake | null {
  if (!lakeName) return null;
  const q = lakeName.trim().toLowerCase();
  if (!q) return null;
  return (
    LAKES.find((l) => l.name.toLowerCase() === q || l.szg?.toLowerCase() === q) ??
    LAKES.find(
      (l) => l.name.toLowerCase().includes(q) || q.includes(l.slug.replace(/-/g, " ")),
    ) ??
    null
  );
}
