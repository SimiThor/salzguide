// DIE EINE SCHREIBSTELLE FÜR DIE FOTOS EINES SPOTS.
//
// WARUM ES DIESE DATEI GIBT:
// Die Regeln standen in saveSpot (lib/admin-actions.ts): erstes Bild = Hero, dazu eine
// ~160px-Vorschau, die gesperrte Pro-Spots als einziges Bild ausliefern. Der WordPress-
// Import schrieb seine media-Zeilen daneben selbst — ohne Vorschau. Ergebnis: 95 Hero-
// Fotos, kein einziges blur_url, und JEDER gesperrte Pro-Spot zeigte statt des unscharfen
// Teasers nur das Emoji auf grauem Verlauf (LockedMedia fällt genau darauf zurück).
// Schlimmer noch: Der Import löschte und schrieb die Zeilen bei jedem Lauf neu, hätte also
// auch nachgezogene Vorschauen wieder weggeworfen.
//
// Deshalb schreibt ab jetzt NIEMAND mehr direkt in media(type='image'). Wer die Fotos eines
// Spots setzt, ruft writeSpotImages – Admin-Formular wie Import. Eine neue Schreibstelle
// (Skript, Aktion, Migration) gehört hier durch, nicht daneben.
//
// Bewusst OHNE "server-only": scripts/wp-import/import.ts importiert diese Datei mit Nodes
// ESM-Loader. sharp (via blur-preview.ts) läuft ohnehin nur serverseitig.
import type { SupabaseClient } from "@supabase/supabase-js";
// Endung PFLICHT wie in blur-preview.ts: Skripte laden diese Datei ohne Bundler.
import {
  createBlurPreview,
  planImageBlur,
  removeBlurPreviews,
  removeSpotMediaFiles,
  type StorageApi,
} from "./blur-preview.ts";

// Endung PFLICHT wie oben: Skripte laden diese Datei ohne Bundler.
import { type AiOrigin, parseAiOrigin } from "./ai-origin.ts";

/**
 * Ein Foto, so wie der Aufrufer es kennt. alt ist optional (das Admin-Formular hat kein
 * Feld dafür). aiOrigin: undefined = "nicht angefasst, bestehenden Wert mitführen",
 * null = "ausdrücklich ohne KI", Wert = KI-Herkunft (Art. 50 KI-VO, docs/39).
 */
export type SpotImage = { url: string; alt?: string | null; aiOrigin?: AiOrigin | null };

export type WriteImagesResult =
  | { ok: true }
  | { ok: false; step: string; message: string };

// Wie in blur-preview.ts KEIN handgeschriebener Minimal-Typ für den DB-Client: Supabases
// Query-Builder lässt sich nicht ohne "Type instantiation is excessively deep" nachbilden.
type Db = SupabaseClient;

/**
 * Die Fotos eines Spots setzen (Reihenfolge = Anzeigereihenfolge, erstes Bild = Hero) und
 * dabei die Blur-Vorschau des Heros mitführen.
 *
 * Was passiert:
 *   1. Bisherige Bildzeilen lesen (URL, Vorschau, alt).
 *   2. planImageBlur entscheidet, welche Vorschau schon existiert und welche fehlt.
 *   3. Fehlt dem Hero eine, wird GENAU EINE erzeugt (Download + sharp – teuer, deshalb nie
 *      auf Verdacht).
 *   4. Zeilen neu setzen (delete + insert) – mit Vorschau und alt-Text am jeweiligen BILD.
 *   5. Vorschauen entfernter Fotos wegräumen; die Original-Dateien nur, wenn der Aufrufer
 *      das will (siehe removeUnusedFiles).
 *
 * Die eine Regel dahinter: EINE VORSCHAU GEHÖRT ZUM BILD, NICHT ZUR HERO-ROLLE. Wer ein
 * Foto nach vorn zieht, das schon einmal Hero war, bekommt dessen Vorschau geschenkt, und
 * Umsortieren kann nie eine funktionierende Vorschau wegwerfen (Migration 0037).
 *
 * Scheitert das Erzeugen der Vorschau, bleibt die Spalte null: Ein Netzfehler beim
 * Vorschaubild darf ein Speichern nicht kippen. Die Anzeige fällt dann auf das Emoji
 * zurück, und der wöchentliche Wartungslauf (backfillMissingPreviews) holt es nach.
 * DB-Fehler dagegen werden gemeldet – der Aufrufer entscheidet, ob er zurückrollt.
 */
export async function writeSpotImages(
  db: Db,
  storage: StorageApi,
  spotId: string,
  images: SpotImage[],
  opts: {
    /**
     * Dateien der ENTFERNTEN Fotos aus dem Bucket löschen. Für das Admin-Formular richtig:
     * Wer dort ein Foto herausnimmt, will es weghaben, und jeder Upload hat einen eigenen
     * UUID-Pfad, gehört also genau diesem Spot.
     *
     * Der WP-Import setzt es auf false: Seine Dateien stehen in .wp-cache/media-map.json,
     * und die Karte ist die Wiederaufnahme-Marke eines fast 1 GB grossen Downloads. Löschte
     * ein Lauf die Datei, zeigte die Karte danach auf ein Loch und der nächste Lauf trüge
     * eine tote URL ein. Liegengebliebenes räumt der wöchentliche Waisen-Sweep ab.
     */
    removeUnusedFiles?: boolean;
  } = {},
): Promise<WriteImagesResult> {
  const removeUnusedFiles = opts.removeUnusedFiles ?? true;
  const urls = images.map((i) => i.url);

  // ALLE bisherigen Bildzeilen, nicht nur das Hero: Nur so kann eine bestehende Vorschau
  // einem Foto folgen, das zwischenzeitlich in der Galerie stand.
  const { data: prevRows, error: prevErr } = await db
    .from("media")
    .select("url, blur_url, alt, ai_origin")
    .eq("spot_id", spotId)
    .eq("type", "image");
  if (prevErr) return { ok: false, step: "Fotos lesen", message: prevErr.message };

  const prev = (prevRows ?? []) as {
    url: string;
    blur_url: string | null;
    alt: string | null;
    ai_origin: string | null;
  }[];
  const plan = planImageBlur(prev, urls);

  if (plan.heroNeedingPreview) {
    const made = await createBlurPreview(storage, plan.heroNeedingPreview);
    if (made) plan.blurByUrl.set(plan.heroNeedingPreview, made);
  }

  // Der alt-Text gehört wie die Vorschau zum BILD. Ohne dieses Übertragen löschte jedes
  // Speichern im Admin die Alternativtexte des Imports – das Formular hat kein Feld dafür,
  // und was nicht im Formular steht, käme sonst als null zurück.
  const altByUrl = new Map(prev.filter((r) => r.alt).map((r) => [r.url, r.alt]));

  // Die KI-Herkunft gehört wie alt und Vorschau zum BILD und wird nach derselben Regel
  // mitgeführt: Ein Aufrufer, der aiOrigin gar nicht kennt (undefined, z. B. der
  // WP-Import), darf einen gesetzten Wert nicht löschen. Nur ein ausdrückliches null
  // ("ohne KI" im Admin gewählt) setzt zurück.
  const aiOriginByUrl = new Map(prev.map((r) => [r.url, parseAiOrigin(r.ai_origin)]));

  // Delete+Insert ist nicht transaktional -> BEIDE Fehler prüfen. Ein stiller Insert-Fehler
  // hiess früher „Spot gespeichert, aber alle Fotos weg".
  // .eq("type", "image") ist Absicht: Videos in derselben Tabelle gehen uns nichts an.
  const { error: delErr } = await db
    .from("media")
    .delete()
    .eq("spot_id", spotId)
    .eq("type", "image");
  if (delErr) return { ok: false, step: "Fotos löschen", message: delErr.message };

  if (images.length) {
    const { error: insErr } = await db.from("media").insert(
      images.map((img, i) => ({
        spot_id: spotId,
        type: "image",
        role: i === 0 ? "hero" : "gallery",
        url: img.url,
        alt: img.alt ?? altByUrl.get(img.url) ?? null,
        sort_order: i,
        blur_url: plan.blurByUrl.get(img.url) ?? null,
        ai_origin:
          img.aiOrigin !== undefined ? img.aiOrigin : (aiOriginByUrl.get(img.url) ?? null),
      })),
    );
    if (insErr) return { ok: false, step: "Fotos schreiben", message: insErr.message };
  }

  // Aufräumen erst NACH dem Insert, damit ein Fehler dabei nichts gerade Gespeichertes
  // reisst. Best-effort: beide Funktionen loggen nur.
  if (plan.orphanPreviews.length) await removeBlurPreviews(storage, plan.orphanPreviews);

  if (removeUnusedFiles) {
    const removedOriginals = prev
      .map((r) => r.url)
      .filter((u): u is string => typeof u === "string" && u !== "" && !urls.includes(u));
    if (removedOriginals.length) await removeSpotMediaFiles(storage, removedOriginals);
  }

  return { ok: true };
}
