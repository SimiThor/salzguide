import "server-only";
import { unstable_cache } from "next/cache";
import { cachedJson } from "./api-cache";
import { createServiceClient } from "./supabase/service";
import {
  EXPLORE_REVALIDATE,
  SPOTS_TAG,
  heroPreviewFromMedia,
  imagesFromMedia,
  lockedName,
  viewerCanSeePro,
} from "./spots";
import { findLake, type Lake } from "./lakes";

// Wassertemperaturen aus kostenlosen Behörden-Open-Data:
//  - Land Salzburg (Hydrografie Seen, ~echtzeit) -> 1h Cache, bevorzugt
//  - AGES Badegewässer (Salzburg, saisonal) -> 12h Cache, Fallback/kleinere Seen
// Gleiches kosteneffizientes Cache-Muster wie Wetter/Places (max. 1 Abruf pro
// Quelle & TTL, nicht pro Besucher).

type Reading = { tempC: number; at: string }; // at = ISO-Zeitpunkt/Datum der Messung
export type WaterMaps = { szg: Record<string, Reading>; ages: Record<string, Reading> };
export type LakeReading = { tempC: number; at: string; source: "salzburg" | "ages" };

const SZG_URL =
  "https://www.salzburg.gv.at/ogd/56c28e2d-8b9e-41ba-b7d6-fa4896b5b48b/Hydrografie%20Seen.txt";
const AGES_URL = "https://www.ages.at/typo3temp/badegewaesser_db.json";
// Nur aktuelle Messwerte zeigen: im Sommer sind Wassertemperaturen von vor Wochen
// irreführend (nach einer Hitzeperiode kann sich der See in Tagen stark ändern).
// -> Messwerte älter als 7 Tage werden verworfen. EINE Quelle der Wahrheit für
// Detailseiten (getLakeReadingByName) UND Übersicht (lookupLake).
const MAX_AGE_DAYS = 7;

// Plausibilitätsgrenzen. Das Alter allein reicht NICHT: Die Rohdaten sind laut Quelle
// „ungeprüft", und ein einzelner Sensor kann driften, ohne dass das Alter etwas verrät.
// Am 16.07.2026 meldete der Grabensee-Sensor 84 von 94 Messungen über 35 °C, Spitze
// 95,5 °C, während alle anderen Seen brav zwischen 22 und 28 °C lagen. Ohne diese Prüfung
// stand das ungefiltert auf /wasser: „amtlich gemessen: 95 °C". Genau die eine Zahl, nach
// der einem niemand mehr irgendetwas glaubt.
//
// 35 °C als Obergrenze: der wärmste österreichische Badesee kommt in einer Hitzewelle auf
// knapp 30. 0 °C als Untergrenze: darunter ist es kein flüssiger See mehr, sondern ein
// kaputter Sensor. Beides mit Absicht grosszügig — wir wollen defekte Fühler aussortieren,
// nicht einen echten Rekordsommer.
const MIN_PLAUSIBLE_C = 0;
const MAX_PLAUSIBLE_C = 35;

function plausible(tempC: number): boolean {
  return Number.isFinite(tempC) && tempC >= MIN_PLAUSIBLE_C && tempC <= MAX_PLAUSIBLE_C;
}

// "2026.07.04T06:00:00+0100 MEZ" -> "2026-07-04T06:00:00+0100"
function szgTime(s: string): string {
  const m = s
    .trim()
    .match(/^(\d{4})\.(\d{2})\.(\d{2})T(\d{2}:\d{2}:\d{2})([+-]\d{4})?/);
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}${m[5] ?? "+0100"}` : "";
}
// "09.06.2026" -> "2026-06-09"
function deDate(d: unknown): string {
  const m = String(d ?? "").match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : "";
}

async function fetchSzg(): Promise<Record<string, Reading>> {
  const res = await fetch(SZG_URL, { signal: AbortSignal.timeout(9000) });
  if (!res.ok) throw new Error(`salzburg ${res.status}`);
  const text = new TextDecoder("windows-1252").decode(await res.arrayBuffer());
  const out: Record<string, Reading> = {};
  const lines = text.split(/\r?\n/);
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(";");
    if (c.length < 7 || c[5] !== "WT") continue; // nur Wassertemperatur
    const v = Number(c[6]);
    if (!Number.isFinite(v)) continue; // "--"/leer überspringen
    const lake = c[2].trim();
    const at = szgTime(c[4]);
    if (at && (!out[lake] || at > out[lake].at)) out[lake] = { tempC: v, at };
  }
  return out;
}

type AgesSite = {
  BADEGEWAESSERNAME?: string;
  MESSWERTE?: { D?: string; W?: unknown }[];
};

async function fetchAges(): Promise<Record<string, Reading>> {
  const res = await fetch(AGES_URL, { signal: AbortSignal.timeout(9000) });
  if (!res.ok) throw new Error(`ages ${res.status}`);
  const j = (await res.json()) as {
    BUNDESLAENDER?: { BUNDESLAND?: string; BADEGEWAESSER?: AgesSite[] }[];
  };
  const szg = j.BUNDESLAENDER?.find((b) => b?.BUNDESLAND === "Salzburg");
  const out: Record<string, Reading> = {};
  for (const site of szg?.BADEGEWAESSER ?? []) {
    const name = site?.BADEGEWAESSERNAME;
    if (!name) continue;
    const mws = site?.MESSWERTE ?? [];
    for (let i = mws.length - 1; i >= 0; i--) {
      const w = Number(mws[i]?.W);
      if (Number.isFinite(w) && w > 0) {
        const at = deDate(mws[i].D);
        if (at) out[name] = { tempC: w, at };
        break;
      }
    }
  }
  return out;
}

export async function getWaterMaps(): Promise<WaterMaps> {
  const [szg, ages] = await Promise.all([
    cachedJson<Record<string, Reading>>("watertemp:szg", 3600, fetchSzg),
    cachedJson<Record<string, Reading>>("watertemp:ages", 12 * 3600, fetchAges),
  ]);
  return { szg: szg ?? {}, ages: ages ?? {} };
}

function ageDays(at: string, now: number): number {
  const t = Date.parse(at);
  return Number.isFinite(t) ? (now - t) / 86_400_000 : Infinity;
}

// In-Memory-Lookup (kein weiterer Abruf) – Salzburg-Echtzeit bevorzugt, sonst AGES.
export function lookupLake(
  maps: WaterMaps,
  lake: Lake,
  now: number,
): LakeReading | null {
  // Ein Wert muss BEIDES sein: aktuell genug UND plausibel. Ist er unplausibel, wird er
  // wie ein zu alter Wert behandelt, also verworfen. Lieber keine Zahl als eine falsche:
  // der See fällt dann aus der Übersicht, statt „95 °C" zu behaupten.
  if (lake.szg) {
    const r = maps.szg[lake.szg];
    if (r && ageDays(r.at, now) <= MAX_AGE_DAYS && plausible(r.tempC))
      return { tempC: r.tempC, at: r.at, source: "salzburg" };
  }
  const a = maps.ages[lake.ages];
  if (a && ageDays(a.at, now) <= MAX_AGE_DAYS && plausible(a.tempC))
    return { tempC: a.tempC, at: a.at, source: "ages" };
  return null;
}

// See -> zugehörige Spots (mehrere möglich!) über spot.lake_name.
// Ergebnis: { lakeSlug: [{ slug, title, emoji, image, ... }] }. So findet man leicht
// alle Spots am Lieblingssee.
//
// Gating wie überall (getExploreData/getRelatedSpots): Service-Client zum Lesen, am
// BETRACHTER entscheiden. Gesperrte Pro-Spots kommen als Teaser zurück (Blur-Vorschau,
// kein echter Slug, kein Titel) — vorher wurden sie einfach ausgelassen, und ein See,
// der NUR Pro-Spots hat (z.B. Wolfgangsee), stand auf /wasser scheinbar ohne Spots da.
// Auch zahlende Pro-Kunden sahen dort nichts, obwohl die Detailseite ihnen alles zeigt.
export type LakeSpot = {
  slug: string;
  title: string;
  shortDesc: string | null;
  emoji: string | null;
  image: string | null;
  // Für DIESEN Betrachter gesperrt? Dann sind slug/title Tarnwerte (locked-<i> /
  // "Geheimtipp") und der Client öffnet ProGate statt zu verlinken — wie SpotCardData.
  locked: boolean;
  // Blur-Vorschau (~160px) – nur bei locked gesetzt, als Teaser fürs Foto.
  previewUrl: string | null;
};

type SpotRow = {
  slug: string;
  emoji: string | null;
  is_pro: boolean;
  lake_name: string | null;
  spot_translations?: { title?: string; short_desc?: string | null; lang?: string }[];
  media?: unknown;
};

// Gleiche Cache-Regel wie der Katalog (Begründung ausführlich in lib/spots.ts über
// getExploreData): genau ZWEI Antworten je Sprache (pro/public), die Betrachter-Frage
// fällt AUSSERHALB des Caches — unstable_cache darf keine Cookies anfassen.
export async function getLakeSpots(
  locale: string,
): Promise<Record<string, LakeSpot[]>> {
  const canSeePro = await viewerCanSeePro();
  return unstable_cache(
    () => queryLakeSpots(locale, canSeePro),
    ["lake-spots", locale, canSeePro ? "pro" : "public"],
    { tags: [SPOTS_TAG], revalidate: EXPLORE_REVALIDATE },
  )();
}

async function queryLakeSpots(
  locale: string,
  canSeePro: boolean,
): Promise<Record<string, LakeSpot[]>> {
  const out: Record<string, LakeSpot[]> = {};
  try {
    const supabase = createServiceClient();
    const { data } = await supabase
      .from("spots")
      .select(
        "slug, emoji, is_pro, lake_name, spot_translations(title, short_desc, lang), media(url, role, sort_order, blur_url)",
      )
      .eq("status", "published");
    const lockedSpotName = lockedName(locale);
    const rows = (data ?? []) as SpotRow[];
    for (let i = 0; i < rows.length; i++) {
      const s = rows[i];
      const lake = findLake(s.lake_name);
      if (!lake) continue;
      const tr = s.spot_translations ?? [];
      const trm = tr.find((t) => t.lang === locale) ?? tr.find((t) => t.lang === "de");
      const locked = s.is_pro && !canSeePro;
      // Gesperrt: nichts Echtes ausliefern (kein Slug/Titel/Text/Foto) — dieselbe Regel
      // wie in getExploreData. Der Zeilen-Index hält den Tarn-Slug eindeutig.
      (out[lake.slug] ??= []).push({
        slug: locked ? `locked-${i}` : s.slug,
        title: locked ? lockedSpotName : (trm?.title ?? s.slug),
        shortDesc: locked ? null : (trm?.short_desc ?? null),
        emoji: locked ? null : (s.emoji ?? null),
        image: locked ? null : (imagesFromMedia(s.media)[0] ?? null),
        previewUrl: locked ? heroPreviewFromMedia(s.media) : null,
        locked,
      });
    }
    // Verlinkbares zuerst, Teaser dahinter – wer den See antippt, soll erst echte
    // Spots sehen, dann das Angebot.
    for (const list of Object.values(out))
      list.sort((a, b) => Number(a.locked) - Number(b.locked));
  } catch {
    /* egal -> keine Verlinkung */
  }
  return out;
}

// Detail-Modul: per Freitext-Seename (spot.lake_name).
export async function getLakeReadingByName(
  lakeName: string,
): Promise<{ lake: Lake; reading: LakeReading | null } | null> {
  const lake = findLake(lakeName);
  if (!lake) return null;
  const maps = await getWaterMaps();
  return { lake, reading: lookupLake(maps, lake, Date.now()) };
}
