// Die Dateien des Inhalts-Caches unter .wp-cache/ — Pfade und ein Leser.
//
// WARUM DIESE DATEI SO KLEIN IST, und was hier bis zum 11.08.2026 stand:
// Sie hiess `fetch.ts` und holte den Bestand der alten WordPress-Seite über deren
// REST-Schnittstelle (`npm run wp:fetch`, mit WP_USER/WP_APP_PASSWORD aus .env.local).
// Seit dem Domain-Umzug am 09.08.2026 gibt es diese Seite nicht mehr, und das
// Anwendungspasswort war schon am 27.07.2026 widerrufen. Der abholende Teil konnte also
// nie wieder laufen; er ist raus, samt der drei Variablen. Was blieb, ist der Teil, den die
// nachgelagerten Schritte weiterhin brauchen: wo der Cache liegt und wie man ihn liest.
//
// Der Cache selbst (.wp-cache/, gitignoriert) ist vollständig und bleibt unangetastet —
// `wp:extract` und alles danach arbeiten unverändert damit weiter. Wer den Abruf je
// nachlesen will (warum `context=edit` nötig war, wie die 40 Pro-Spots erkannt wurden):
// scripts/wp-import/README.md hält beides fest, der Code steht in der Git-Historie.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const CACHE_DIR = ".wp-cache";
export const POSTS_FILE = join(CACHE_DIR, "posts.json");
export const MEDIA_FILE = join(CACHE_DIR, "media.json");
/** Slugs, die ein GAST nicht lesen konnte. Die einzige verlässliche Pro-Quelle. */
export const PRO_FILE = join(CACHE_DIR, "pro-slugs.json");
/** Emoji + Pro-Flag + Saison aus den zwei Frontend-Karten der alten Seite. */
export const MAPS_FILE = join(CACHE_DIR, "maps.json");

export function readCache<T>(file: string): T {
  // Früher stand hier „bitte zuerst npm run wp:fetch". Den Befehl gibt es nicht mehr, und
  // ein Hinweis auf einen Befehl, der nicht existiert, kostet den Nächsten eine
  // Viertelstunde. Nachlegen kann diese Datei niemand mehr — fehlt sie, ist der Cache
  // unvollständig, und das ist die Auskunft, die hier gebraucht wird.
  if (!existsSync(file))
    throw new Error(
      `${file} fehlt. Der Cache unter ${CACHE_DIR}/ ist die einzige Quelle — die alte ` +
        `WordPress-Seite gibt es seit dem Umzug am 09.08.2026 nicht mehr, ein erneuter ` +
        `Abruf ist also nicht möglich.`,
    );
  return JSON.parse(readFileSync(file, "utf8")) as T;
}
