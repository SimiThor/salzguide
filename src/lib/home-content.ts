import "server-only";
import { cache } from "react";
import { createServiceClient } from "./supabase/service";
import { hashTexts } from "./spot-hash";
import { homeTextParts, type HomeTexts } from "./home-fields";
import {
  parseLandingImage,
  parseLandingVideo,
  type LandingImage,
  type LandingVideo,
} from "./landing-media";
import deMessages from "../../messages/de.json";

// Texte und Medien der Startseite aus der DB (home_content, Migration 0036), mit
// messages/de.json als Auffangnetz.
//
// DIE DREI-STUFEN-REGEL, und die Reihenfolge ist wichtig:
//   1. Übersetzung aus der DB für diese Sprache
//   2. sonst: deutscher Text aus der DB
//   3. sonst: messages/de.json
//
// Stufe 3 ist der Grund, warum hier nichts kaputtgehen kann: Solange die Tabelle leer ist
// (oder ein einzelner Key fehlt, oder die DB gerade nicht antwortet), sieht die Startseite
// exakt aus wie vor diesem Umbau. Der Admin kann also Feld für Feld übernehmen, statt alles
// auf einmal eintragen zu müssen.
//
// Stufe 2 vor Stufe 3: Wer den deutschen Text im Admin ändert, aber noch nicht übersetzt
// hat, soll in JEDER Sprache den NEUEN deutschen Text sehen, nicht den alten aus der Datei.

export type HomeMedia = {
  /** Hero, Handy: Hochformat 9:16. */
  heroPortrait: LandingImage | null;
  /** Hero, Desktop: Querformat ~16:9. */
  heroLandscape: LandingImage | null;
  /** Erklär-/Gründervideo, Hochformat 9:16. Ein Video reicht für beide Geräte. */
  explainerVideo: LandingVideo | null;
  // ZWEI Gesichter, nicht eines. Hier stand ein einzelner `founders`-Slot, und die
  // Gründer-Section rendert ihn PRO PERSON: Antons Foto hätte also neben Simons Namen
  // gestanden. Zwei Gründer sind zwei Bilder, und der Typ sagt das jetzt.
  antonPhoto: LandingImage | null;
  simonPhoto: LandingImage | null;
};

type Row = {
  texts: HomeTexts | null;
  translations: Record<string, HomeTexts> | null;
  source_hash: string | null;
  media: Partial<HomeMedia> | null;
};

// Die Datei-Texte als unterste Stufe. Nicht `as HomeTexts`, sondern geprüft: Was in der
// JSON kein String ist, ist kein Text.
const FILE_TEXTS: HomeTexts = Object.fromEntries(
  Object.entries((deMessages as { Home?: Record<string, unknown> }).Home ?? {}).filter(
    (e): e is [string, string] => typeof e[1] === "string",
  ),
);

// Ein Request liest die Zeile höchstens einmal, egal wie viele Sections danach fragen.
//
// Service-Client, NICHT der Cookie-Client: Der Inhalt der Startseite ist für JEDEN Besucher
// derselbe, ein Cookie ändert daran nichts. Der Cookie-Client hat ihn aber trotzdem gelesen,
// und sobald eine Seite Cookies liest, muss Next sie bei jedem einzelnen Aufruf neu rendern.
// Die Startseite war deshalb `ƒ` (pro Request), obwohl sie eine Verkaufsseite ist, die sich
// selten ändert: 269ms und drei DB-Abfragen für jeden Besucher, mal neun Sprachen, mal jeden
// Crawler. Ohne Cookie kann Next sie vorrendern und aus dem Cache ausliefern.
//
// Aktuell bleibt sie trotzdem: Die vier Speicher-Aktionen im Admin (saveHomeTexts,
// saveHomeMedia, saveHomeFeatured, fillHomeTranslations) rufen bereits revalidatePath für
// alle Sprachen auf — diese Aufrufe liefen bisher nur ins Leere, weil an einer dynamischen
// Seite nichts zu invalidieren ist.
const readRow = cache(async function readRow(): Promise<Row | null> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("home_content")
    .select("texts, translations, source_hash, media")
    .eq("id", 1)
    .maybeSingle();
  if (error) {
    // Migration noch nicht eingespielt oder DB gerade weg: Auffangnetz greift, die Seite
    // steht trotzdem. Genau dafür ist es da.
    console.error("home_content:", error.message);
    return null;
  }
  return (data as Row | null) ?? null;
});

/** Die Texte der Startseite in der gewünschten Sprache, mit Fallback auf Deutsch und Datei. */
export async function getHomeTexts(locale: string): Promise<HomeTexts> {
  const row = await readRow();
  const dbDe = row?.texts ?? {};
  const dbLoc = locale === "de" ? {} : (row?.translations?.[locale] ?? {});

  const out: HomeTexts = { ...FILE_TEXTS };
  // Leere Strings zählen NICHT als gepflegt: Ein leeres Feld im Admin soll auf die Stufe
  // darunter zurückfallen, statt die Seite auszuradieren.
  for (const [k, v] of Object.entries(dbDe)) if (typeof v === "string" && v.trim()) out[k] = v;
  for (const [k, v] of Object.entries(dbLoc)) if (typeof v === "string" && v.trim()) out[k] = v;
  return out;
}

/** Bilder und Videos der Startseite. Sprach-unabhängig. */
export async function getHomeMedia(): Promise<HomeMedia> {
  const row = await readRow();
  const m = (row?.media ?? {}) as Record<string, unknown>;
  // Jeder Slot einzeln geprüft: Ein kaputter Eintrag kostet SEINEN Platzhalter, nicht die
  // Seite. Ungeprüft durchgereicht („...row.media") landete alles direkt in next/image.
  return {
    heroPortrait: parseLandingImage(m.heroPortrait),
    heroLandscape: parseLandingImage(m.heroLandscape),
    explainerVideo: parseLandingVideo(m.explainerVideo),
    antonPhoto: parseLandingImage(m.antonPhoto),
    simonPhoto: parseLandingImage(m.simonPhoto),
  };
}

/** Versionsmarke der deutschen Texte. Weicht sie ab, sind die Übersetzungen veraltet. */
export function homeSourceHash(texts: HomeTexts): string {
  return hashTexts(homeTextParts(texts));
}

// Setzt {count} & Co. ein. Ersetzt bewusst next-intls ICU, denn die Startseiten-Texte
// laufen nicht mehr über next-intl (sie kommen aus der DB, siehe Kommentar oben).
//
// Das ist eine echte Einschränkung, und sie ist geprüft: Der ganze Home-Namespace hat
// GENAU EINEN Platzhalter ({count}, zweimal) und keine einzige Plural- oder Select-Regel.
// Für 40 Zeilen mit einem Platzhalter eine ICU-Engine mitzuschleppen, wäre Aufwand ohne
// Nutzen — und es hat einen Vorteil: Anton kann im Admin keine ICU-Syntax hineinschreiben,
// die erst zur Laufzeit wirft. Was hier nicht passt, bleibt einfach stehen und fällt auf.
//
// Braucht die Startseite je einen Plural („1 Spot" vs. „2 Spots"), gehört das hierher und
// nicht in den Text: dann zwei Keys, so wie trustSpotsTitle/trustSpotsTitleExact es schon
// für die Zehner-Schwelle machen.
export function fill(text: string, vars: Record<string, string | number>): string {
  let out = text;
  for (const [k, v] of Object.entries(vars)) {
    out = out.split(`{${k}}`).join(String(v));
  }
  return out;
}
