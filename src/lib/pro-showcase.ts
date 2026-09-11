// Die Motive für den Bilderstreifen auf /pro (components/ProShowcase.tsx).
//
// Service-Client, weil die RLS anonymen Lesern die Pro-Spots verbirgt (Migration 0017), und
// genau die werden hier gezeigt. Unbedenklich, weil diese Funktion nur eine Anzahl, übersetzte
// Art-Namen und Blur-Vorschauen verlässt (deren Dateiname ist eine Zufalls-ID). Kein Slug,
// kein Titel, keine Gemeinde, keine Koordinate.
import { unstable_cache } from "next/cache";
import type { ProShowcaseData } from "@/components/ProShowcase";
import { createServiceClient } from "./supabase/service";
import { EXPLORE_REVALIDATE, SPOTS_TAG, heroPreviewFromMedia } from "./spots";
import { factSubtype } from "./facts-i18n";

// Sechs Kacheln: fünf Motive mit ihrer Art und als sechste das „+N". Am iPhone sind drei ganz
// und ein Stück der vierten sichtbar, der Rest kommt beim Wischen.
const TILE_MAX = 6;

/**
 * Die Reihenfolge der Kacheln: WARUM Leute zu uns kommen, nicht wie der Katalog sortiert ist.
 *
 * Gemessen vom 09.08. bis 11.09.2026 (ohne den Scraper aus Asien), Öffnungen in Explore /
 * Aufrufe von Instagram-Besuchern / Merkungen:
 *   Wandern 197 / 79 / 18 · Aussicht & Foto 68 / 17 / 10 · Seen 54 / 50 / 1 ·
 *   Food 41 / 9 / 0 · Klammen & Wasserfälle 23 / 5 / 5 · Spaziergänge & Stadt 9 / 3 / 1 ·
 *   Bahnen, Schifffahrt & Action 0 / 0 / 0
 *
 * Food steht bewusst eine Stelle vor Aussicht & Foto: So zeigen die drei Kacheln, die man ohne
 * Wischen sieht, Natur UND Essen, und Food ist ein Hauptgrund, Pro zu kaufen (Anton,
 * 11.09.2026). Bahnen, Schifffahrt, Thermen und Action fehlen ganz: Dafür zahlt niemand.
 * Die letzte Art trägt das „+N" und zeigt einen Spaziergang oder versteckten Ort.
 *
 * Die Werte sind die Art-Schlüssel aus spots.subtype (dieselben wie in facts-i18n.json).
 */
const THEMES: readonly (readonly string[])[] = [
  ["Bergwanderung", "Bergtour", "Wanderung", "Gipfel", "Themenweg", "Winterwanderung"],
  ["Bergsee", "See & Baden", "Badeplatz"],
  ["Café", "Restaurant", "Specialty Coffee", "Almhütte", "Wirtshaus", "Streetfood", "Konditorei", "Berghütte", "Gasthof", "Gipfelrestaurant", "Brauerei"],
  ["Aussichtspunkt", "Fotospot", "Panoramastraße"],
  ["Klamm", "Wasserfall"],
  ["Spazierweg", "Stadtspaziergang", "Altstadt & Gasse", "Park & Garten"],
];

// Innerhalb einer Art: erst Antons Stufe aus dem Admin (Highlight vor Stark vor Normal), dann
// die Geheimtipps im engen Sinn. Setzt jemand später Highlights, rücken die von selbst nach vorn.
const FAME_RANK: Record<string, number> = {
  "Hidden Gem": 0,
  "Lokal beliebt": 1,
  Bekannt: 2,
  "Touristen-Hotspot": 3,
};

type Row = {
  slug: string;
  subtype: string | null;
  seasons: string[] | null;
  fame: string | null;
  sort_weight: number | null;
};

/**
 * Saison nach Monat in Wien: November bis März Winter, sonst Sommer. Nur für die Auswahl der
 * Motive: Im September ein verschneites Bild zu zeigen, wirkt so falsch wie im Dezember eine
 * Badestelle. Bewusst hier und grob: Die App kennt sonst keine „aktuelle" Saison, Explore lässt
 * den Menschen wählen.
 */
function seasonNow(): "summer" | "winter" {
  const month = Number(
    new Intl.DateTimeFormat("en", { month: "numeric", timeZone: "Europe/Vienna" }).format(new Date()),
  );
  return month >= 11 || month <= 3 ? "winter" : "summer";
}

// Die Kachel ist 92px breit, davon 76px innen (px-2), die Schrift 12px halbfett — die Zahlen
// stehen in components/ProShowcase.tsx. Ein lateinischer Buchstabe misst darin im Schnitt gut
// 6,5px, ein chinesisches oder koreanisches Zeichen volle 12px.
const TILE_TEXT_WIDTH_PX = 76;
const CHAR_PX = 6.6;
const WIDE_CHAR_PX = 12;
const WIDE_CHAR = /[ᄀ-ᇿ⺀-鿿가-힯＀-｠]/;

/**
 * Passt die GANZE Beschriftung in eine Zeile der Kachel? Gemessen wird der volle Text, nicht
 * nur das längste Wort: Ein Text bricht auch am Leerzeichen um, sobald er insgesamt zu breit
 * ist, und „Randonnée en montagne" stand am iPhone über vier Zeilen. Gewünscht ist gar kein
 * Umbruch (Anton, 12.09.2026).
 *
 * Die Rechnung ist grob und darf es sein: Sie entscheidet nur, welcher von mehreren gleich
 * guten Spots die Kachel bekommt. Liegt sie daneben, bricht die Beschriftung um wie bisher,
 * abgeschnitten wird nie etwas.
 */
function labelFitsOneLine(subtype: string | null, locale: string): boolean {
  const label = factSubtype(subtype, locale);
  if (!label) return false;
  const width = [...label].reduce((w, ch) => w + (WIDE_CHAR.test(ch) ? WIDE_CHAR_PX : CHAR_PX), 0);
  return width <= TILE_TEXT_WIDTH_PX;
}

/**
 * Die Motive in der Sprache der Seite. Ein Ergebnis je Sprache und Saison, gecacht wie der
 * Katalog (SPOTS_TAG): Stellt jemand im Admin einen Spot um, zieht der Streifen mit. null, wenn
 * es nichts zu zeigen gibt oder die Abfrage scheitert: Dann bleibt die Pro-Seite, wie sie war.
 */
export function getProShowcase(locale: string): Promise<ProShowcaseData | null> {
  const season = seasonNow();
  return unstable_cache(() => queryProShowcase(locale, season), ["pro-showcase", locale, season], {
    tags: [SPOTS_TAG],
    revalidate: EXPLORE_REVALIDATE,
  })();
}

async function queryProShowcase(
  locale: string,
  season: "summer" | "winter",
): Promise<ProShowcaseData | null> {
  const svc = createServiceClient();
  const { data, error } = await svc
    .from("spots")
    .select("slug, subtype, seasons, fame, sort_weight")
    .eq("status", "published")
    .eq("is_pro", true);
  if (error) {
    console.error("getProShowcase:", error.message);
    return null;
  }

  const pro = (data ?? []) as Row[];
  if (pro.length === 0) return null;

  // Innerhalb einer Art: Stufe, dann Bekanntheit, dann die Reihenfolge der Arten in THEMES.
  // Die ist dort nach Beliebtheit sortiert (Bergwanderung 91 Öffnungen, Bergtour 81,
  // Wanderung 5); ohne sie entschied das Alphabet, und „Wanderung" schlug „Bergwanderung".
  // Ohne Zufall: Das Ergebnis liegt im Cache, und Zufall hiesse eine andere Seite nach jeder
  // Erneuerung. Der Slug am Ende macht die Reihenfolge eindeutig.
  const byRank = (subtypes: readonly string[]) => (a: Row, b: Row) =>
    (b.sort_weight ?? 0) - (a.sort_weight ?? 0) ||
    (FAME_RANK[a.fame ?? ""] ?? 9) - (FAME_RANK[b.fame ?? ""] ?? 9) ||
    subtypes.indexOf(a.subtype ?? "") - subtypes.indexOf(b.subtype ?? "") ||
    a.slug.localeCompare(b.slug);
  const inSeason = pro.filter((r) => (r.seasons ?? []).includes(season));

  // Je Art der beste Spot der laufenden Saison. Hat eine Art in dieser Saison keinen, fällt sie
  // weg, statt ein Motiv aus der falschen Jahreszeit zu zeigen.
  //
  // Unter gleich guten Kandidaten gewinnt der mit der KÜRZEREN Beschriftung: „Bergwanderung"
  // passt nicht in die Kachel und stand getrennt als „Bergwan-derung" da. Ein kürzerer Titel
  // sieht besser aus als ein zerhacktes Wort (Anton, 12.09.2026), und mit „Bergtour" steht dort
  // die zweitbeliebteste Art statt der beliebtesten. Nur das Zerhacken WORTE stört: Ein Umbruch
  // am Leerzeichen („Lac de montagne") ist in Ordnung, deshalb zählt das längste Wort.
  const picked: Row[] = [];
  for (const subtypes of THEMES) {
    const candidates = inSeason
      .filter((r) => r.subtype && subtypes.includes(r.subtype) && !picked.includes(r))
      .sort(byRank(subtypes));
    // Fällt nichts in eine Zeile, bleibt der beste Kandidat: Die Silbentrennung in
    // ProShowcase.tsx fängt ihn auf, abgeschnitten wird nie etwas.
    const pick = candidates.find((r) => labelFitsOneLine(r.subtype, locale)) ?? candidates[0];
    if (pick) picked.push(pick);
  }
  if (picked.length === 0) return null;

  // Die Vorschau NUR für die gezeigten Motive (zweite, schlanke Abfrage wie in lib/spots.ts).
  const { data: media, error: mediaErr } = await svc
    .from("spots")
    .select("slug, media(url, role, sort_order, blur_url)")
    .in(
      "slug",
      picked.slice(0, TILE_MAX).map((p) => p.slug),
    );
  if (mediaErr) {
    console.error("getProShowcase (Vorschau):", mediaErr.message);
    return null;
  }
  const mediaBySlug = new Map((media ?? []).map((s) => [s.slug as string, s.media]));

  return {
    pro: pro.length,
    // Der Schlüssel ist ein Zähler, nicht der Slug: Er landet als React-key im HTML.
    tiles: picked.slice(0, TILE_MAX).map((p, i) => ({
      key: `tile-${i}`,
      previewUrl: heroPreviewFromMedia(mediaBySlug.get(p.slug)),
      label: factSubtype(p.subtype, locale) ?? null,
    })),
  };
}
