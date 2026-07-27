// Holt den kompletten Spot-Bestand der ALTEN WordPress-Seite in einen lokalen Cache.
// Aufruf:  npm run wp:fetch
//
// WARUM `context=edit` und nicht der normale Abruf:
// Die Pro-Spots (40 von 102) liegen hinter „Simple Membership". Das Plugin hängt am
// `the_content`-Filter, deshalb liefert der öffentliche Abruf dort NUR den Kauf-Hinweis.
// Ein Anwendungspasswort hilft dagegen nicht, weil das Plugin seine eigene Sitzung prüft
// und nicht den WordPress-Login. `context=edit` umgeht das Problem an der Wurzel: Es gibt
// `content.raw` zurück, also den ungefilterten Inhalt aus der Datenbank, bevor irgendein
// Filter ihn zu sehen bekommt. Der Rohinhalt ist ausserdem der bessere Ausgangsstoff:
// keine Elementor-Div-Suppe, dafür die Shortcodes mit den Parkplatz-Koordinaten.
//
// Der Cache liegt unter .wp-cache/ (gitignoriert) und wird nur neu geholt, was fehlt.
// Ein Import, den man nicht ohne Netz wiederholen kann, ist kein Import, sondern ein Ritt.
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.WP_BASE_URL ?? "https://www.salzguide.com";
const USER = process.env.WP_USER ?? "";
const PASS = process.env.WP_APP_PASSWORD ?? "";

/** Kategorie „alle" auf der alten Seite: der deutsche Spot-Bestand. */
const CATEGORY_ALL = 9;

export const CACHE_DIR = ".wp-cache";
export const POSTS_FILE = join(CACHE_DIR, "posts.json");
export const MEDIA_FILE = join(CACHE_DIR, "media.json");
/** Slugs, die ein GAST nicht lesen kann. Die einzige verlässliche Pro-Quelle. */
export const PRO_FILE = join(CACHE_DIR, "pro-slugs.json");
/** Emoji + Pro-Flag + Saison aus den zwei Frontend-Karten der alten Seite. */
export const MAPS_FILE = join(CACHE_DIR, "maps.json");

function auth(): string {
  if (!USER || !PASS)
    throw new Error("WP_USER / WP_APP_PASSWORD fehlen in .env.local (siehe scripts/wp-import/README.md)");
  return "Basic " + Buffer.from(`${USER}:${PASS}`).toString("base64");
}

// Ein Abruf mit Wiederholung. Die alte Seite ist langsam und hat schon im Normalbetrieb
// Aussetzer; ohne Wiederholung fehlt am Ende ein Spot und niemand merkt welcher.
async function get(path: string): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${BASE}/wp-json/${path}`, {
        headers: { Authorization: auth() },
        signal: AbortSignal.timeout(60_000),
      });
      if (res.ok) return res;
      if (res.status < 500 && res.status !== 429) {
        throw new Error(`HTTP ${res.status} bei ${path}: ${(await res.text()).slice(0, 200)}`);
      }
      lastErr = new Error(`HTTP ${res.status}`);
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
  }
  throw lastErr;
}

// Alle Seiten einer Sammlung einsammeln. WordPress deckelt per_page bei 100 und meldet
// die Gesamtzahl im Header; die wird gegengeprüft, damit eine stumme Kürzung auffällt.
async function getAll(path: string): Promise<unknown[]> {
  const out: unknown[] = [];
  let total = -1;
  for (let page = 1; page <= 50; page++) {
    const sep = path.includes("?") ? "&" : "?";
    const res = await get(`${path}${sep}per_page=100&page=${page}`);
    if (total < 0) total = Number(res.headers.get("x-wp-total") ?? -1);
    const batch = (await res.json()) as unknown[];
    out.push(...batch);
    if (batch.length < 100) break;
  }
  if (total >= 0 && out.length !== total)
    throw new Error(`${path}: ${out.length} geholt, ${total} erwartet — Abruf unvollständig`);
  return out;
}

/**
 * Die zwei Frontend-Karten der alten Seite. Beide tragen je Spot ein `spots`-Array im
 * Seitenquelltext, und darin steht, was sonst nirgends sauber steht: das Emoji und das
 * Pro-Flag.
 *
 * Warum das eine eigene Quelle wert ist: Das Emoji kommt im Seitenquelltext nur bei EINER
 * der beiden Karten-Generationen vor, und der Rückfall (der erste Punkt der Route) lieferte
 * für Loipe und Rodelbahn ein 📸. Die Karte weiss es besser, sie zeigt es ja an.
 *
 * `season` ist keine Angabe der alten Seite, sondern die Zuordnung der Karte selbst: Was
 * auf der Gastein-Karte steht, ist Winter-Inhalt.
 */
const MAP_PAGES: { path: string; season: "summer" | "winter" | null }[] = [
  { path: "/", season: null },
  { path: "/gastein/", season: "winter" },
];

type MapEntry = { isPro: boolean; emoji: string | null; season: "summer" | "winter" | null };

async function fetchMaps(): Promise<Record<string, MapEntry>> {
  const out: Record<string, MapEntry> = {};
  for (const page of MAP_PAGES) {
    const res = await fetch(`${BASE}${page.path}`, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`Karte ${page.path}: HTTP ${res.status}`);
    const html = await res.text();

    // `const spots = [{…}]` aus dem Seitenquelltext schneiden. Klammern zählen statt
    // Regex: Die Beschreibungen enthalten Klammern, jedes „bis zum nächsten ]" liegt daneben.
    const at = html.search(/(?:const|var|let)\s+spots\s*=\s*\[/);
    if (at < 0) throw new Error(`Karte ${page.path}: kein spots-Array gefunden`);
    const start = html.indexOf("[", at);
    let depth = 0;
    let end = -1;
    for (let i = start; i < html.length; i++) {
      if (html[i] === "[") depth++;
      else if (html[i] === "]" && --depth === 0) { end = i; break; }
    }
    if (end < 0) throw new Error(`Karte ${page.path}: spots-Array nicht geschlossen`);

    const spots = JSON.parse(html.slice(start, end + 1)) as {
      link: string;
      isPro?: boolean;
      emoji?: string;
      emojiFree?: string;
    }[];
    for (const s of spots) {
      const slug = s.link.replace(/\/+$/, "").split("/").pop();
      if (!slug) continue;
      out[slug] = {
        isPro: Boolean(s.isPro),
        emoji: s.emoji ?? s.emojiFree ?? null,
        season: page.season,
      };
    }
    console.log(`  ${page.path} -> ${spots.length} Punkte`);
  }
  return out;
}

async function main() {
  mkdirSync(CACHE_DIR, { recursive: true });

  const me = (await (await get("wp/v2/users/me?context=edit")).json()) as {
    name?: string;
    capabilities?: Record<string, boolean>;
  };
  // Ohne edit_posts liefert `context=edit` nur einen 403, und zwar pro Spot einzeln.
  // Lieber hier einmal hart abbrechen als 102 leere Dateien schreiben.
  if (!me.capabilities?.edit_posts)
    throw new Error(`Konto „${me.name}" darf keine Beiträge bearbeiten — context=edit nicht möglich`);
  console.log(`angemeldet als ${me.name}`);

  console.log("Spots holen (context=edit, also inklusive Pro-Inhalt) …");
  const posts = await getAll(`wp/v2/posts?categories=${CATEGORY_ALL}&context=edit&status=any`);
  writeFileSync(POSTS_FILE, JSON.stringify(posts, null, 1));
  console.log(`  ${posts.length} Spots -> ${POSTS_FILE}`);

  // ZWEITER Durchgang, bewusst OHNE Anmeldung. Er holt nichts Neues, er beantwortet eine
  // Frage, die der erste nicht beantworten kann: Welche Spots sind Pro?
  //
  // „Simple Membership" legt seine Sperre in einem geschützten postmeta ab, das die
  // REST-Schnittstelle nicht herausgibt — in `meta` steht dazu nichts. Und `context=edit`,
  // das uns überhaupt erst an die Pro-Inhalte bringt, umgeht denselben Filter, der den
  // Kauf-Hinweis erzeugt. Der authentifizierte Abruf sieht also NIE, dass ein Spot gesperrt
  // ist. Sichtbar wird es nur so, wie ein Gast es sieht: Steht öffentlich der Kauf-Hinweis
  // statt des Inhalts, ist der Spot Pro. Ohne diesen Durchgang landeten alle 40 Pro-Spots
  // frei zugänglich in der neuen App, und niemandem fiele es auf, bis es zu spät ist.
  console.log("Pro-Sperre prüfen (anonymer Abruf, wie ein Gast sie sieht) …");
  const proSlugs: string[] = [];
  for (let page = 1; page <= 5; page++) {
    const res = await fetch(
      `${BASE}/wp-json/wp/v2/posts?categories=${CATEGORY_ALL}&per_page=100&page=${page}&_fields=slug,content`,
      { signal: AbortSignal.timeout(60_000) },
    );
    if (!res.ok) throw new Error(`Pro-Prüfung: HTTP ${res.status}`);
    const batch = (await res.json()) as { slug: string; content: { rendered: string } }[];
    for (const p of batch)
      if (p.content.rendered.includes("swpm-post-not-logged-in")) proSlugs.push(p.slug);
    if (batch.length < 100) break;
  }
  writeFileSync(PRO_FILE, JSON.stringify(proSlugs, null, 1));
  console.log(`  ${proSlugs.length} Pro-Spots -> ${PRO_FILE}`);

  console.log("Karten der alten Seite auslesen …");
  const maps = await fetchMaps();
  writeFileSync(MAPS_FILE, JSON.stringify(maps, null, 1));
  const conflicts = Object.entries(maps).filter(
    ([slug, m]) => m.isPro !== proSlugs.includes(slug),
  );
  console.log(`  ${Object.keys(maps).length} Karten-Einträge -> ${MAPS_FILE}`);
  console.log(
    conflicts.length
      ? `  ACHTUNG: ${conflicts.length} widersprechen dem anonymen Abruf: ${conflicts.map(([s]) => s).join(", ")}`
      : `  Pro-Flag stimmt bei allen mit dem anonymen Abruf überein.`,
  );

  console.log("Mediathek holen (Originale in voller Auflösung) …");
  const media = await getAll("wp/v2/media?context=edit");
  writeFileSync(MEDIA_FILE, JSON.stringify(media, null, 1));
  console.log(`  ${media.length} Dateien -> ${MEDIA_FILE}`);
}

export function readCache<T>(file: string): T {
  if (!existsSync(file)) throw new Error(`${file} fehlt — bitte zuerst „npm run wp:fetch"`);
  return JSON.parse(readFileSync(file, "utf8")) as T;
}

if (import.meta.filename === process.argv[1]) {
  main().catch((err) => {
    console.error("\nFEHLER:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
